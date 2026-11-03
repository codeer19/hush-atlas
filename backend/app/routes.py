"""FastAPI routes for Hush Atlas."""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import demo as demo_module
from .analysis import analysis_payload, perform_analysis
from .evidence import comparison_evidence, comparison_report, fingerprint_payload
from .audio import (
    AudioValidationError,
    SUPPORTED_EXTENSIONS,
    audio_mime,
    safe_display_filename,
    supported_format_summary,
)
from .comparison import (
    ComparisonError,
    ComparisonNotFoundError,
    create_comparison,
    get_comparison,
    list_comparisons,
    notable_changes,
)
from .config import Settings
from .db import (
    connect,
    db_is_healthy,
    delete_setting,
    set_setting,
    utc_now_iso,
)
from .reflection import (
    GemmaService,
    generate_reflection,
    get_reflection,
)
from .repository import (
    audio_file_path,
    create_place,
    delete_place,
    delete_recording,
    get_place,
    get_recording,
    get_recording_row,
    list_places,
    store_uploaded_file,
    update_place,
    update_recording,
)
from .schemas import (
    AcousticMapOut,
    AnalysisJobOut,
    AnalysisRequest,
    AnalysisResponse,
    ComparisonCreate,
    ComparisonListItem,
    ComparisonOut,
    ComparabilityPreviewOut,
    DemoStatusOut,
    DeleteOut,
    FingerprintOut,
    GemmaSelectRequest,
    GemmaStatusOut,
    HealthOut,
    LatestRecordingOut,
    MessageOut,
    ModelsStatusOut,
    NotableChangeOut,
    OverviewOut,
    PlaceCreate,
    PlaceDetailOut,
    PlaceOut,
    PlaceUpdate,
    RecordingDetailOut,
    RecordingOut,
    RecordingUpdate,
    ReflectionOut,
    ReflectionRequest,
    RouteOut,
    RouteSummaryOut,
    StopComparisonOut,
    WalkComparisonRequest,
    WalkCreate,
    WalkMapOut,
    WalkOut,
    WalkStopOut,
    WalkStopUpdate,
    WalkSummaryOut,
    WalkUpdate,
    WaveformOut,
    YamnetStatusOut,
)
from .missions import MISSIONS
from .walks import (
    WalkError,
    WalkNotFoundError,
    attach_recording,
    compare_walk,
    comparison_preview,
    create_walk,
    delete_walk,
    get_route,
    get_walk,
    list_routes,
    list_walks,
    repeat_walk,
    update_walk,
    update_walk_stop,
    walk_map,
    walk_report,
)
from .yamnet_service import YamnetEngine
from .comparison import latest_run_for_recording
from .analysis import top_classes_for_recording


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _engine(request: Request) -> YamnetEngine:
    return request.app.state.engine


def _gemma(request: Request) -> GemmaService:
    return request.app.state.gemma


def _analysis_job(settings: Settings, engine: YamnetEngine, recording_id: int, threshold: float) -> None:
    try:
        perform_analysis(settings, engine, recording_id, threshold)
    except Exception:  # noqa: BLE001 - failure is persisted by perform_analysis
        logger.exception("Background analysis failed for recording %s", recording_id)


def _parse_recorded_at(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("The recorded date and time is not a valid ISO 8601 value.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _require_place(settings: Settings, place_id: int) -> dict[str, Any]:
    place = get_place(settings, place_id)
    if not place:
        raise HTTPException(status_code=404, detail=f"Place {place_id} does not exist.")
    return place


async def _receive_stop_audio(
    request: Request,
    *,
    place_id: int,
    file: UploadFile,
    title: str,
    notes: str,
    recorded_at: str,
    source: str,
) -> dict[str, Any]:
    settings = _settings(request)
    if source not in {"upload", "browser_recording"}:
        raise HTTPException(
            status_code=422,
            detail="source must be 'upload' or 'browser_recording'.",
        )
    try:
        recorded = _parse_recorded_at(recorded_at)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    display_name = safe_display_filename(file.filename, "recording")
    suffix = Path(display_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                "Unsupported file extension. Use WAV, FLAC, MP3, or Ogg Vorbis. "
                f"Supported formats in this installation: {', '.join(supported_format_summary())}."
            ),
        )
    max_bytes = settings.max_upload_mb * 1024 * 1024
    temp_path = settings.audio_dir / f".part-{uuid.uuid4().hex}{suffix}"
    total = 0
    try:
        with temp_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"This file exceeds the {settings.max_upload_mb} MB upload limit. "
                            "Trim or compress the recording and try again."
                        ),
                    )
                destination.write(chunk)
        if total == 0:
            raise HTTPException(status_code=422, detail="The recording is empty.")
        try:
            return await run_in_threadpool(
                store_uploaded_file,
                settings,
                place_id=place_id,
                title=title.strip()[:200] or "Listening point",
                notes=notes,
                recorded_at=recorded,
                original_filename=display_name,
                temp_path=temp_path,
                source=source,
            )
        except AudioValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


@router.get("/health", response_model=HealthOut)
def health(request: Request) -> Response:
    settings = _settings(request)
    engine = _engine(request)
    database_ok = db_is_healthy(settings)
    assets_ok = settings.weights_path.is_file() and settings.class_map_path.is_file()
    payload = {
        "status": "ok" if database_ok else "degraded",
        "app": settings.app_name,
        "version": settings.version,
        "time": utc_now_iso(),
        "database": database_ok,
        "local_only": not settings.hosted,
        "audio_model_assets": assets_ok,
    }
    return JSONResponse(status_code=200 if database_ok else 503, content=payload)


@router.get("/models/status", response_model=ModelsStatusOut)
def models_status(request: Request) -> dict[str, Any]:
    settings = _settings(request)
    audio = _engine(request).status()
    gemma = _gemma(request).status()
    offline_ready = audio["status"] == "ready"
    if offline_ready:
        if settings.hosted:
            detail = (
                "The sound reader is ready. Recordings are analysed on the "
                "Hush Atlas server. On-device AI is set up separately in your "
                "browser; without it, reflections use a plain reading."
            )
        else:
            detail = (
                "Finding sounds works offline. On-device AI is set up separately in "
                "your browser; without it, reflections use a plain reading."
            )
    else:
        detail = (
            "Finding sounds is not ready yet. Finish setup before relying on offline use."
        )
    return {
        "audio": audio,
        "gemma": gemma,
        "offline_ready": offline_ready,
        "offline_detail": detail,
    }


@router.get("/models/gemma", response_model=GemmaStatusOut)
def gemma_status(request: Request) -> dict[str, Any]:
    return _gemma(request).status()


@router.put("/models/gemma", response_model=GemmaStatusOut)
def gemma_select(request: Request, payload: GemmaSelectRequest) -> dict[str, Any]:
    try:
        return _gemma(request).select_model(payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/places", response_model=list[PlaceOut])
def places_index(request: Request) -> list[dict[str, Any]]:
    return list_places(_settings(request), include_demo=False)


@router.post("/places", response_model=PlaceOut, status_code=201)
def place_create(request: Request, payload: PlaceCreate) -> dict[str, Any]:
    return create_place(_settings(request), payload.name, payload.description)


@router.get("/places/{place_id}", response_model=PlaceDetailOut)
def place_detail(request: Request, place_id: int) -> dict[str, Any]:
    return _require_place(_settings(request), place_id)


@router.patch("/places/{place_id}", response_model=PlaceOut)
def place_update(request: Request, place_id: int, payload: PlaceUpdate) -> dict[str, Any]:
    settings = _settings(request)
    _require_place(settings, place_id)
    updated = update_place(settings, place_id, payload.name, payload.description)
    if not updated:
        raise HTTPException(status_code=404, detail="Place not found.")
    updated.pop("recordings", None)
    return updated


@router.delete("/places/{place_id}", response_model=DeleteOut)
def place_delete(request: Request, place_id: int) -> dict[str, Any]:
    settings = _settings(request)
    deleted, warnings = delete_place(settings, place_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Place not found.")
    return {"deleted": True, "id": place_id, "warnings": warnings}


@router.get("/places/{place_id}/recordings", response_model=list[RecordingOut])
def place_recordings(request: Request, place_id: int) -> list[dict[str, Any]]:
    place = _require_place(_settings(request), place_id)
    return place["recordings"]


@router.post("/places/{place_id}/recordings", response_model=RecordingOut, status_code=201)
async def recording_upload(
    request: Request,
    place_id: int,
    file: UploadFile = File(...),
    title: str = Form(default=""),
    notes: str = Form(default=""),
    recorded_at: str = Form(default=""),
    source: str = Form(default="upload"),
) -> dict[str, Any]:
    settings = _settings(request)
    _require_place(settings, place_id)
    if source not in {"upload", "browser_recording"}:
        raise HTTPException(
            status_code=422,
            detail="source must be 'upload' or 'browser_recording'.",
        )
    if not title.strip():
        base = safe_display_filename(file.filename, "recording")
        title = Path(base).stem.replace("_", " ").strip() or "Untitled recording"
    if len(title.strip()) > 200:
        raise HTTPException(status_code=422, detail="Recording titles may be at most 200 characters.")
    if len(notes) > 8000:
        raise HTTPException(status_code=422, detail="Notes may be at most 8,000 characters.")
    try:
        recorded = _parse_recorded_at(recorded_at)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    display_name = safe_display_filename(file.filename, "recording")
    suffix = Path(display_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                "Unsupported file extension. Use WAV, FLAC, MP3, or Ogg Vorbis. "
                f"Supported formats in this installation: {', '.join(supported_format_summary())}."
            ),
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    temp_path = settings.audio_dir / f".part-{uuid.uuid4().hex}{suffix}"
    total = 0
    try:
        with temp_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"This file exceeds the {settings.max_upload_mb} MB upload limit. "
                            "Trim or compress the recording and try again."
                        ),
                    )
                destination.write(chunk)
        if total == 0:
            raise HTTPException(status_code=422, detail="The uploaded file is empty.")
        try:
            recording = await run_in_threadpool(
                store_uploaded_file,
                settings,
                place_id=place_id,
                title=title.strip(),
                notes=notes,
                recorded_at=recorded,
                original_filename=display_name,
                temp_path=temp_path,
                source=source,
            )
        except AudioValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return recording
    finally:
        await file.close()
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


@router.get("/recordings/{recording_id}", response_model=RecordingDetailOut)
def recording_detail(request: Request, recording_id: int) -> dict[str, Any]:
    recording = get_recording(_settings(request), recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found.")
    return recording


@router.patch("/recordings/{recording_id}", response_model=RecordingOut)
def recording_update(
    request: Request, recording_id: int, payload: RecordingUpdate
) -> dict[str, Any]:
    settings = _settings(request)
    if not get_recording_row(settings, recording_id):
        raise HTTPException(status_code=404, detail="Recording not found.")
    updated = update_recording(
        settings,
        recording_id,
        title=payload.title,
        notes=payload.notes,
        recorded_at=payload.recorded_at,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Recording not found.")
    updated.pop("waveform", None)
    updated.pop("audio_url", None)
    return updated


@router.delete("/recordings/{recording_id}", response_model=DeleteOut)
def recording_delete(request: Request, recording_id: int) -> dict[str, Any]:
    settings = _settings(request)
    deleted, warnings = delete_recording(settings, recording_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Recording not found.")
    return {"deleted": True, "id": recording_id, "warnings": warnings}


@router.get("/recordings/{recording_id}/waveform", response_model=WaveformOut)
def recording_waveform(request: Request, recording_id: int) -> dict[str, Any]:
    recording = get_recording(_settings(request), recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found.")
    return recording["waveform"]


@router.get("/recordings/{recording_id}/audio")
def recording_audio(request: Request, recording_id: int) -> FileResponse:
    settings = _settings(request)
    try:
        located = audio_file_path(settings, recording_id)
    except (ValueError, AudioValidationError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not located:
        raise HTTPException(
            status_code=404,
            detail="The original audio file is missing from the archive.",
        )
    path, audio_format = located
    return FileResponse(
        path,
        media_type=audio_mime(audio_format),
        headers={
            "Cache-Control": "private, max-age=0, must-revalidate",
            "Accept-Ranges": "bytes",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/recordings/{recording_id}/analyze", response_model=AnalysisJobOut, status_code=202)
def recording_analyze(
    request: Request,
    recording_id: int,
    payload: AnalysisRequest | None = None,
) -> dict[str, Any]:
    settings = _settings(request)
    engine = _engine(request)
    recording = get_recording_row(settings, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found.")
    if recording["analysis_status"] in {"queued", "running"}:
        raise HTTPException(
            status_code=409,
            detail="This recording is already queued for analysis.",
        )
    body = payload or AnalysisRequest()
    threshold = body.threshold or settings.default_score_threshold
    with connect(settings) as connection:
        latest = latest_run_for_recording(connection, recording_id)
    if (
        latest
        and latest["status"] == "completed"
        and not body.force
    ):
        return {
            "recording_id": recording_id,
            "status": "completed",
            "run_id": latest["id"],
            "message": "The sounds in this recording are already found. Run the search again if you want fresh results.",
        }
    audio_status = engine.status()
    if audio_status["status"] != "ready":
        raise HTTPException(
            status_code=503,
            detail=f"{audio_status['label']}: {audio_status['detail']}",
        )
    now = utc_now_iso()
    with connect(settings) as connection:
        connection.execute(
            """
            UPDATE recordings
               SET analysis_status = 'queued', analysis_error = NULL, updated_at = ?
             WHERE id = ?
            """,
            (now, recording_id),
        )
        connection.execute(
            """
            UPDATE walk_stops
               SET status = 'analysis_pending', updated_at = ?
             WHERE recording_id = ?
               AND status IN ('recorded', 'analysis_failed', 'analyzed', 'reviewed')
            """,
            (now, recording_id),
        )
        connection.commit()
    try:
        request.app.state.analysis_pool.submit(
            _analysis_job,
            settings,
            engine,
            recording_id,
            threshold,
        )
    except Exception as exc:  # noqa: BLE001
        with connect(settings) as connection:
            connection.execute(
                """
                UPDATE recordings SET analysis_status = 'failed', analysis_error = ?,
                       updated_at = ?
                 WHERE id = ?
                """,
                (f"Could not start the analysis worker: {exc}", utc_now_iso(), recording_id),
            )
            connection.commit()
        raise HTTPException(status_code=500, detail="Could not start the sound search.") from exc
    return {
        "recording_id": recording_id,
        "status": "queued",
        "run_id": None,
        "message": "Looking for sounds. This runs on this device and may take a little while.",
    }


@router.get("/recordings/{recording_id}/analysis", response_model=AnalysisResponse)
def recording_analysis(request: Request, recording_id: int) -> dict[str, Any]:
    settings = _settings(request)
    if not get_recording_row(settings, recording_id):
        raise HTTPException(status_code=404, detail="Recording not found.")
    return analysis_payload(settings, recording_id)


@router.get("/places/{place_id}/map", response_model=AcousticMapOut)
def place_map(request: Request, place_id: int) -> dict[str, Any]:
    settings = _settings(request)
    place = _require_place(settings, place_id)
    recordings: list[dict[str, Any]] = []
    class_labels: dict[int, str] = {}
    with connect(settings) as connection:
        rows = connection.execute(
            "SELECT * FROM recordings WHERE place_id = ? ORDER BY recorded_at ASC, id ASC",
            (place_id,),
        ).fetchall()
        for row in rows:
            run = latest_run_for_recording(connection, int(row["id"]), completed_only=True)
            events: list[dict[str, Any]] = []
            top_classes = top_classes_for_recording(connection, int(row["id"]), limit=12)
            if run:
                allowed = [item["class_index"] for item in top_classes]
                if allowed:
                    event_rows = connection.execute(
                        f"""
                        SELECT class_index, class_label, start_seconds, end_seconds, model_score
                          FROM event_detections
                         WHERE analysis_run_id = ?
                           AND class_index IN ({','.join('?' for _ in allowed)})
                         ORDER BY start_seconds ASC
                         LIMIT 1200
                        """,
                        [run["id"], *allowed],
                    ).fetchall()
                    for event in event_rows:
                        class_labels[event["class_index"]] = event["class_label"]
                        events.append(
                            {
                                "class_index": event["class_index"],
                                "label": event["class_label"],
                                "start_seconds": event["start_seconds"],
                                "end_seconds": event["end_seconds"],
                                "model_score": event["model_score"],
                            }
                        )
                for item in top_classes:
                    class_labels[item["class_index"]] = item["label"]
            recordings.append(
                {
                    "recording_id": row["id"],
                    "title": row["title"],
                    "recorded_at": row["recorded_at"],
                    "duration_seconds": row["duration_seconds"],
                    "analysis_status": row["analysis_status"],
                    "analysis_run_id": run["id"] if run else None,
                    "top_classes": top_classes,
                    "events": events,
                }
            )
    return {
        "place_id": place["id"],
        "place_name": place["name"],
        "is_demo": place["is_demo"],
        "recordings": recordings,
        "classes": [
            {"class_index": index, "label": label}
            for index, label in sorted(class_labels.items(), key=lambda item: item[1].lower())
        ],
        "note": (
            "A map of the sounds found in these recordings, arranged by time. "
            "No real location is recorded or implied."
        ),
    }


@router.get("/missions")
def missions_index() -> list[dict[str, Any]]:
    return MISSIONS


@router.get("/routes", response_model=list[RouteSummaryOut])
def routes_index(request: Request) -> list[dict[str, Any]]:
    return list_routes(_settings(request))


@router.get("/routes/{route_id}", response_model=RouteOut)
def route_detail(request: Request, route_id: int) -> dict[str, Any]:
    route = get_route(_settings(request), route_id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found.")
    return route


@router.get("/walks", response_model=list[WalkSummaryOut])
def walks_index(request: Request, status: str | None = None) -> list[dict[str, Any]]:
    try:
        return list_walks(_settings(request), status)
    except WalkError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/walks", response_model=WalkOut, status_code=201)
def walk_create(request: Request, payload: WalkCreate) -> dict[str, Any]:
    try:
        return create_walk(_settings(request), payload.model_dump())
    except WalkNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WalkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/walks/{session_id}", response_model=WalkOut)
def walk_detail(request: Request, session_id: int) -> dict[str, Any]:
    walk = get_walk(_settings(request), session_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found.")
    return walk


@router.patch("/walks/{session_id}", response_model=WalkOut)
def walk_update(request: Request, session_id: int, payload: WalkUpdate) -> dict[str, Any]:
    try:
        walk = update_walk(
            _settings(request),
            session_id,
            status=payload.status,
            notes=payload.notes,
        )
    except WalkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found.")
    return walk


@router.delete("/walks/{session_id}", response_model=DeleteOut)
def walk_delete(request: Request, session_id: int) -> dict[str, Any]:
    deleted = delete_walk(_settings(request), session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Walk not found.")
    return {
        "deleted": True,
        "id": session_id,
        "warnings": ["Recordings from this walk remain in the archive with no walk link."],
    }


@router.patch("/walks/{session_id}/stops/{stop_id}", response_model=WalkStopOut)
def walk_stop_update(
    request: Request,
    session_id: int,
    stop_id: int,
    payload: WalkStopUpdate,
) -> dict[str, Any]:
    try:
        return update_walk_stop(
            _settings(request),
            session_id,
            stop_id,
            observation=payload.observation,
            status=payload.status,
        )
    except WalkNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WalkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/walks/{session_id}/stops/{stop_id}/recording",
    response_model=RecordingOut,
    status_code=201,
)
async def walk_stop_recording(
    request: Request,
    session_id: int,
    stop_id: int,
    file: UploadFile = File(...),
    title: str = Form(default=""),
    notes: str = Form(default=""),
    recorded_at: str = Form(default=""),
    source: str = Form(default="upload"),
) -> dict[str, Any]:
    settings = _settings(request)
    walk = get_walk(settings, session_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found.")
    stop = next((item for item in walk["stops"] if item["id"] == stop_id), None)
    if stop is None:
        raise HTTPException(status_code=404, detail="Stop not found in this walk.")
    if walk["status"] != "active":
        raise HTTPException(
            status_code=409,
            detail="Resume this walk before adding another recording.",
        )
    if not title.strip():
        title = f"{stop['stop_order'] + 1}. {stop['name']}"
    recording = await _receive_stop_audio(
        request,
        place_id=walk["place_id"],
        file=file,
        title=title,
        notes=notes,
        recorded_at=recorded_at,
        source=source,
    )
    try:
        attach_recording(settings, session_id, stop_id, int(recording["id"]))
    except (WalkError, WalkNotFoundError) as exc:
        delete_recording(settings, int(recording["id"]))
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    update_walk(settings, session_id, notes=None)
    return recording


@router.post("/walks/{session_id}/repeat", response_model=WalkOut, status_code=201)
def walk_repeat(request: Request, session_id: int) -> dict[str, Any]:
    try:
        return repeat_walk(_settings(request), session_id)
    except WalkNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WalkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/walks/{session_id}/map", response_model=WalkMapOut)
def walk_map_detail(request: Request, session_id: int) -> dict[str, Any]:
    payload = walk_map(_settings(request), session_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Walk not found.")
    return payload


@router.get(
    "/walks/{session_id}/comparison-preview",
    response_model=ComparabilityPreviewOut,
)
def walk_comparison_preview(
    request: Request, session_id: int, other_session_id: int | None = None
) -> dict[str, Any]:
    try:
        return comparison_preview(_settings(request), session_id, other_session_id)
    except WalkNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WalkError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/walks/{session_id}/compare",
    response_model=ComparisonOut,
    status_code=201,
)
def walk_compare(
    request: Request, session_id: int, payload: WalkComparisonRequest
) -> dict[str, Any]:
    try:
        return compare_walk(
            _settings(request),
            session_id,
            other_session_id=payload.other_session_id,
            baseline_stop_ids=payload.baseline_stop_ids or None,
            recent_stop_ids=payload.recent_stop_ids or None,
            threshold=payload.threshold,
            fading_threshold_pp=payload.fading_threshold_pp,
        )
    except WalkNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (WalkError, ComparisonError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/walks/{session_id}/report")
def walk_report_download(request: Request, session_id: int) -> Response:
    try:
        markdown = walk_report(_settings(request), session_id)
    except WalkNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="hush-atlas-walk-{session_id}.md"'
        },
    )


@router.get("/recordings/{recording_id}/fingerprint", response_model=FingerprintOut)
def recording_fingerprint(request: Request, recording_id: int) -> dict[str, Any]:
    payload = fingerprint_payload(_settings(request), recording_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Recording not found.")
    return payload


@router.get(
    "/comparisons/{comparison_id}/evidence/{class_index}",
    response_model=StopComparisonOut,
)
def comparison_evidence_detail(
    request: Request, comparison_id: int, class_index: int
) -> dict[str, Any]:
    try:
        return comparison_evidence(_settings(request), comparison_id, class_index)
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="That sound class is not present in this comparison.",
        ) from exc


@router.get("/comparisons/{comparison_id}/report")
def comparison_report_download(
    request: Request, comparison_id: int, class_index: int | None = None
) -> Response:
    try:
        markdown = comparison_report(_settings(request), comparison_id, class_index)
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="That sound class is not present in this comparison.",
        ) from exc
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="hush-atlas-comparison-{comparison_id}.md"'
            )
        },
    )


@router.get("/overview", response_model=OverviewOut)
def overview(request: Request) -> dict[str, Any]:
    settings = _settings(request)
    with connect(settings) as connection:
        place_count = connection.execute(
            "SELECT COUNT(*) FROM places WHERE is_demo = 0"
        ).fetchone()[0]
        totals = connection.execute(
            """
            SELECT COUNT(*) AS recording_count,
                   COALESCE(SUM(CASE WHEN r.analysis_status = 'completed' THEN 1 ELSE 0 END), 0)
                       AS analyzed_count,
                   COALESCE(SUM(r.duration_seconds), 0) AS total_duration
              FROM recordings r JOIN places p ON p.id = r.place_id
             WHERE p.is_demo = 0
            """
        ).fetchone()
        latest = connection.execute(
            """
            SELECT r.id, r.place_id, r.title, r.recorded_at, r.analysis_status,
                   p.name AS place_name
              FROM recordings r JOIN places p ON p.id = r.place_id
             WHERE p.is_demo = 0
             ORDER BY r.recorded_at DESC, r.id DESC LIMIT 1
            """
        ).fetchone()
    demo_state = demo_module.demo_status(settings)
    latest_out = None
    if latest:
        latest_out = {
            "id": latest["id"],
            "place_id": latest["place_id"],
            "place_name": latest["place_name"],
            "title": latest["title"],
            "recorded_at": latest["recorded_at"],
            "analysis_status": latest["analysis_status"],
        }
    return {
        "place_count": place_count,
        "recording_count": totals["recording_count"],
        "analyzed_count": totals["analyzed_count"],
        "total_duration_seconds": totals["total_duration"],
        "latest_recording": latest_out,
        "notable_changes": notable_changes(settings, limit=6),
        "demo_available": demo_state["status"] == "ready",
    }


@router.get("/comparisons", response_model=list[ComparisonListItem])
def comparisons_index(request: Request, place_id: int | None = None) -> list[dict[str, Any]]:
    return list_comparisons(_settings(request), place_id)


@router.post("/comparisons", response_model=ComparisonOut, status_code=201)
def comparison_create(request: Request, payload: ComparisonCreate) -> dict[str, Any]:
    settings = _settings(request)
    try:
        comparison_id = create_comparison(settings, payload.model_dump())
        return get_comparison(settings, comparison_id)
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ComparisonError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/comparisons/{comparison_id}", response_model=ComparisonOut)
def comparison_detail(request: Request, comparison_id: int) -> dict[str, Any]:
    try:
        return get_comparison(_settings(request), comparison_id)
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/comparisons/{comparison_id}/reflection/{class_index}",
    response_model=ReflectionOut,
)
def reflection_existing(
    request: Request, comparison_id: int, class_index: int
) -> dict[str, Any]:
    settings = _settings(request)
    try:
        comparison = get_comparison(settings, comparison_id)
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        return get_reflection(settings, comparison, class_index, _gemma(request))
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="That sound class is not present in this comparison.",
        ) from exc


@router.post("/comparisons/{comparison_id}/reflection", response_model=ReflectionOut)
def reflection_generate(
    request: Request, comparison_id: int, payload: ReflectionRequest
) -> dict[str, Any]:
    settings = _settings(request)
    try:
        comparison = get_comparison(settings, comparison_id)
    except ComparisonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        return generate_reflection(
            settings,
            comparison,
            payload.class_index,
            _gemma(request),
            regenerate=payload.regenerate,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="That sound class is not present in this comparison.",
        ) from exc


@router.get("/demo", response_model=DemoStatusOut)
def demo_get(request: Request) -> dict[str, Any]:
    return demo_module.demo_status(_settings(request))


@router.post("/demo/prepare", response_model=DemoStatusOut, status_code=202)
def demo_prepare(request: Request) -> dict[str, Any]:
    settings = _settings(request)
    lock: threading.Lock = request.app.state.demo_lock
    with lock:
        current = demo_module.demo_status(settings)
        if current["status"] in {"ready", "preparing"}:
            return current
        audio_status = _engine(request).status()
        if audio_status["status"] != "ready":
            raise HTTPException(
                status_code=503,
                detail=f"{audio_status['label']}: {audio_status['detail']}",
            )
        delete_setting(settings, demo_module.DEMO_ERROR_KEY)
        delete_setting(settings, demo_module.DEMO_COMPARISON_KEY)
        set_setting(settings, demo_module.DEMO_STATUS_KEY, "preparing")
        try:
            request.app.state.demo_pool.submit(
                demo_module.prepare_demo, settings, _engine(request)
            )
        except Exception as exc:  # noqa: BLE001
            set_setting(settings, demo_module.DEMO_STATUS_KEY, "failed")
            set_setting(
                settings, demo_module.DEMO_ERROR_KEY, f"Could not start demo preparation: {exc}"
            )
            raise HTTPException(
                status_code=500, detail="Could not start sample preparation."
            ) from exc
    return demo_module.demo_status(settings)


@router.delete("/demo", response_model=MessageOut)
def demo_delete(request: Request) -> dict[str, Any]:
    removed = demo_module.remove_demo(_settings(request))
    return {
        "message": "Sample removed." if removed else "There was no sample to remove."
    }
