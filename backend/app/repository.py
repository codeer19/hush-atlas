"""Data access helpers for places and recordings."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .analysis import delete_analysis_artifacts, top_classes_for_recording
from .audio import AudioValidationError, probe_audio
from .config import Settings
from .db import connect, resolve_data_path, utc_now_iso


PLACE_SELECT = """
SELECT p.*,
       COUNT(r.id) AS recording_count,
       COALESCE(SUM(CASE WHEN r.analysis_status = 'completed' THEN 1 ELSE 0 END), 0)
           AS analyzed_count,
       MAX(r.recorded_at) AS last_recorded_at
  FROM places p
  LEFT JOIN recordings r ON r.place_id = p.id
"""


def _place_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "is_demo": bool(row["is_demo"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "recording_count": row["recording_count"],
        "analyzed_count": row["analyzed_count"],
        "last_recorded_at": row["last_recorded_at"],
    }


def list_places(settings: Settings, include_demo: bool = False) -> list[dict[str, Any]]:
    where = "" if include_demo else "WHERE p.is_demo = 0"
    with connect(settings) as connection:
        rows = connection.execute(
            PLACE_SELECT + f" {where} GROUP BY p.id ORDER BY COALESCE(MAX(r.recorded_at), p.created_at) DESC"
        ).fetchall()
    return [_place_dict(row) for row in rows]


def get_place(
    settings: Settings, place_id: int, allow_demo: bool = True
) -> dict[str, Any] | None:
    with connect(settings) as connection:
        row = connection.execute(
            PLACE_SELECT + " WHERE p.id = ? GROUP BY p.id",
            (place_id,),
        ).fetchone()
        if not row:
            return None
        if row["is_demo"] and not allow_demo:
            return None
        result = _place_dict(row)
        result["recordings"] = recording_summaries(connection, place_id)
    return result


def create_place(
    settings: Settings,
    name: str,
    description: str = "",
    is_demo: bool = False,
) -> dict[str, Any]:
    now = utc_now_iso()
    with connect(settings) as connection:
        cursor = connection.execute(
            """
            INSERT INTO places(name, description, is_demo, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (name.strip(), description.strip(), 1 if is_demo else 0, now, now),
        )
        connection.commit()
        place_id = int(cursor.lastrowid)
    result = get_place(settings, place_id)
    assert result is not None
    return result


def update_place(
    settings: Settings,
    place_id: int,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    params: list[Any] = []
    if name is not None:
        updates.append("name = ?")
        params.append(name.strip())
    if description is not None:
        updates.append("description = ?")
        params.append(description.strip())
    if not updates:
        return get_place(settings, place_id)
    updates.append("updated_at = ?")
    params.append(utc_now_iso())
    params.append(place_id)
    with connect(settings) as connection:
        cursor = connection.execute(
            f"UPDATE places SET {', '.join(updates)} WHERE id = ?", params
        )
        connection.commit()
        if cursor.rowcount == 0:
            return None
    return get_place(settings, place_id)


def _audio_path(settings: Settings, internal_path: str) -> Path:
    path = resolve_data_path(settings, internal_path)
    audio_root = settings.audio_dir.resolve()
    if path != audio_root and audio_root not in path.parents:
        raise AudioValidationError("Stored audio path is outside the audio directory.")
    return path


def delete_place(settings: Settings, place_id: int) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    with connect(settings) as connection:
        place = connection.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
        if not place:
            return False, warnings
        recordings = connection.execute(
            "SELECT id, internal_audio_path FROM recordings WHERE place_id = ?", (place_id,)
        ).fetchall()
        recording_ids = [int(row["id"]) for row in recordings]
        audio_paths: list[Path] = []
        for row in recordings:
            try:
                audio_paths.append(_audio_path(settings, row["internal_audio_path"]))
            except ValueError as exc:
                warnings.append(str(exc))
        connection.execute("DELETE FROM places WHERE id = ?", (place_id,))
        if place["is_demo"]:
            connection.execute("DELETE FROM app_settings WHERE key LIKE 'demo_%'")
        connection.commit()
    warnings.extend(delete_analysis_artifacts(settings, recording_ids))
    for path in audio_paths:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            warnings.append(f"Could not delete audio file {path.name}: {exc}")
    return True, warnings


def _recording_dict(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    include_place_name: bool = True,
) -> dict[str, Any]:
    place_name = ""
    if include_place_name:
        place = connection.execute(
            "SELECT name FROM places WHERE id = ?", (row["place_id"],)
        ).fetchone()
        place_name = place["name"] if place else ""
    return {
        "id": row["id"],
        "place_id": row["place_id"],
        "place_name": place_name,
        "title": row["title"],
        "notes": row["notes"],
        "recorded_at": row["recorded_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "duration_seconds": row["duration_seconds"],
        "original_filename": row["original_filename"],
        "audio_format": row["audio_format"],
        "sample_rate": row["sample_rate"],
        "channels": row["channels"],
        "source": row["source"],
        "analysis_status": row["analysis_status"],
        "analysis_error": row["analysis_error"],
        "top_classes": top_classes_for_recording(connection, int(row["id"])),
    }


def recording_summaries(
    connection: sqlite3.Connection, place_id: int
) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM recordings WHERE place_id = ? ORDER BY recorded_at DESC, id DESC",
        (place_id,),
    ).fetchall()
    return [_recording_dict(connection, row, include_place_name=False) for row in rows]


def get_recording(settings: Settings, recording_id: int) -> dict[str, Any] | None:
    with connect(settings) as connection:
        row = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not row:
            return None
        result = _recording_dict(connection, row)
        peaks = json.loads(row["waveform_peaks"] or "[]")
        result["waveform"] = {
            "recording_id": recording_id,
            "duration_seconds": row["duration_seconds"],
            "peaks": peaks,
        }
        result["audio_url"] = f"/api/recordings/{recording_id}/audio"
        return result


def get_recording_row(settings: Settings, recording_id: int) -> sqlite3.Row | None:
    with connect(settings) as connection:
        return connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()


def create_recording(
    settings: Settings,
    *,
    place_id: int,
    title: str,
    notes: str,
    recorded_at: datetime,
    original_filename: str,
    internal_audio_path: str,
    audio_format: str,
    sample_rate: int,
    channels: int,
    duration_seconds: float,
    peaks: list[float],
    source: str,
) -> dict[str, Any]:
    now = utc_now_iso()
    recorded_iso = recorded_at.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )
    with connect(settings) as connection:
        place = connection.execute("SELECT id FROM places WHERE id = ?", (place_id,)).fetchone()
        if not place:
            raise LookupError("Place not found.")
        cursor = connection.execute(
            """
            INSERT INTO recordings(
                place_id, title, notes, recorded_at, created_at, updated_at,
                duration_seconds, original_filename, internal_audio_path, audio_format,
                sample_rate, channels, waveform_peaks, source, analysis_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_analyzed')
            """,
            (
                place_id,
                title.strip(),
                notes.strip(),
                recorded_iso,
                now,
                now,
                duration_seconds,
                original_filename,
                internal_audio_path,
                audio_format,
                sample_rate,
                channels,
                json.dumps(peaks),
                source,
            ),
        )
        connection.commit()
        recording_id = int(cursor.lastrowid)
    result = get_recording(settings, recording_id)
    assert result is not None
    return result


def update_recording(
    settings: Settings,
    recording_id: int,
    title: str | None = None,
    notes: str | None = None,
    recorded_at: datetime | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    params: list[Any] = []
    if title is not None:
        updates.append("title = ?")
        params.append(title.strip())
    if notes is not None:
        updates.append("notes = ?")
        params.append(notes.strip())
    if recorded_at is not None:
        updates.append("recorded_at = ?")
        params.append(
            recorded_at.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
                "+00:00", "Z"
            )
        )
    if not updates:
        return get_recording(settings, recording_id)
    updates.append("updated_at = ?")
    params.append(utc_now_iso())
    params.append(recording_id)
    with connect(settings) as connection:
        cursor = connection.execute(
            f"UPDATE recordings SET {', '.join(updates)} WHERE id = ?", params
        )
        connection.commit()
        if cursor.rowcount == 0:
            return None
    return get_recording(settings, recording_id)


def delete_recording(settings: Settings, recording_id: int) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    with connect(settings) as connection:
        row = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not row:
            return False, warnings
        try:
            audio_path = _audio_path(settings, row["internal_audio_path"])
        except ValueError as exc:
            warnings.append(str(exc))
            audio_path = None
        connection.execute(
            """
            UPDATE walk_stops
               SET recording_id = NULL, status = 'ready_to_record', updated_at = ?
             WHERE recording_id = ?
            """,
            (utc_now_iso(), recording_id),
        )
        connection.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
        connection.commit()
    warnings.extend(delete_analysis_artifacts(settings, [recording_id]))
    if audio_path is not None:
        try:
            audio_path.unlink(missing_ok=True)
        except OSError as exc:
            warnings.append(f"Could not delete audio file {audio_path.name}: {exc}")
    return True, warnings


def store_uploaded_file(
    settings: Settings,
    *,
    place_id: int,
    title: str,
    notes: str,
    recorded_at: datetime,
    original_filename: str,
    temp_path: Path,
    source: str,
) -> dict[str, Any]:
    """Validate a staged upload, move it into the archive and create its row."""
    info = probe_audio(temp_path, settings)
    from .audio import canonical_extension

    extension = canonical_extension(info.audio_format)
    filename = f"{temp_path.stem.split('-')[-1]}{extension}"
    # temp_path is named .part-<uuid>; use a new UUID-safe basename derived from it.
    final_path = settings.audio_dir / filename
    counter = 0
    while final_path.exists():
        counter += 1
        final_path = settings.audio_dir / f"{final_path.stem}-{counter}{extension}"
    temp_path.replace(final_path)
    relative = final_path.relative_to(settings.data_dir.resolve()).as_posix()
    try:
        return create_recording(
            settings,
            place_id=place_id,
            title=title,
            notes=notes,
            recorded_at=recorded_at,
            original_filename=original_filename,
            internal_audio_path=relative,
            audio_format=info.audio_format,
            sample_rate=info.sample_rate,
            channels=info.channels,
            duration_seconds=info.duration_seconds,
            peaks=info.peaks,
            source=source,
        )
    except Exception:
        final_path.unlink(missing_ok=True)
        raise


def audio_file_path(settings: Settings, recording_id: int) -> tuple[Path, str] | None:
    row = get_recording_row(settings, recording_id)
    if not row:
        return None
    path = _audio_path(settings, row["internal_audio_path"])
    if not path.is_file():
        return None
    return path, row["audio_format"]
