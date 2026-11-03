"""Reproducible analysis pipeline and persistence of YAMNet evidence."""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .audio import AudioValidationError, decode_mono, YAMNET_SAMPLE_RATE
from .config import Settings
from .db import connect, portable_relative_path, resolve_data_path, utc_now_iso
from .yamnet_service import ModelUnavailableError, YamnetEngine, MODEL_NAME

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ClassStat:
    class_index: int
    label: str
    detection_rate: float
    detected_windows: int
    window_count: int
    peak_score: float
    mean_score: float


@dataclass(frozen=True)
class EventSegment:
    class_index: int
    label: str
    start_seconds: float
    end_seconds: float
    model_score: float
    mean_score: float
    window_count: int


@dataclass(frozen=True)
class AnalysisComputation:
    window_count: int
    class_stats: list[ClassStat]
    events: list[EventSegment]


def compute_analysis(
    scores: np.ndarray,
    labels: list[str],
    threshold: float,
    duration_seconds: float,
    window_hop_seconds: float = 0.48,
    window_seconds: float = 0.96,
) -> AnalysisComputation:
    """Turn a real YAMNet score matrix into auditable statistics and event spans."""
    scores = np.asarray(scores, dtype=np.float32)
    if scores.ndim != 2:
        raise ValueError("YAMNet scores must be a two-dimensional matrix.")
    if scores.shape[1] != len(labels):
        raise ValueError("YAMNet score columns do not match the class map.")
    if scores.shape[0] == 0:
        raise ValueError("No analysis windows were produced.")
    if not 0.0 < threshold < 1.0:
        raise ValueError("The detection threshold must be between 0 and 1.")
    if not np.isfinite(scores).all():
        raise ValueError("Analysis scores contain invalid values.")
    duration_seconds = max(float(duration_seconds), 0.0)
    window_count = int(scores.shape[0])
    detected = scores >= threshold
    stats: list[ClassStat] = []
    events: list[EventSegment] = []

    for class_index, label in enumerate(labels):
        class_scores = scores[:, class_index]
        class_detected = detected[:, class_index]
        detected_windows = int(class_detected.sum())
        peak_score = float(np.clip(class_scores.max(), 0.0, 1.0))
        mean_score = float(np.clip(class_scores.mean(), 0.0, 1.0))
        stats.append(
            ClassStat(
                class_index=class_index,
                label=label,
                detection_rate=detected_windows / window_count,
                detected_windows=detected_windows,
                window_count=window_count,
                peak_score=peak_score,
                mean_score=mean_score,
            )
        )
        if detected_windows == 0:
            continue

        padded = np.concatenate(([False], class_detected, [False]))
        changes = np.diff(padded.astype(np.int8))
        starts = np.flatnonzero(changes == 1)
        ends = np.flatnonzero(changes == -1) - 1
        for start_window, end_window in zip(starts, ends, strict=True):
            span_scores = class_scores[start_window : end_window + 1]
            start_seconds = float(start_window * window_hop_seconds)
            end_seconds = min(
                duration_seconds,
                float(end_window * window_hop_seconds + window_seconds),
            )
            if end_seconds <= start_seconds:
                end_seconds = min(duration_seconds, start_seconds + 0.01)
            events.append(
                EventSegment(
                    class_index=class_index,
                    label=label,
                    start_seconds=round(start_seconds, 3),
                    end_seconds=round(max(end_seconds, start_seconds + 0.01), 3),
                    model_score=float(np.clip(span_scores.max(), 0.0, 1.0)),
                    mean_score=float(np.clip(span_scores.mean(), 0.0, 1.0)),
                    window_count=int(end_window - start_window + 1),
                )
            )

    return AnalysisComputation(
        window_count=window_count,
        class_stats=stats,
        events=events,
    )


def save_score_matrix(
    settings: Settings,
    recording_id: int,
    run_id: int,
    scores: np.ndarray,
    labels: list[str],
    window_hop_seconds: float,
    window_seconds: float,
) -> Path:
    directory = settings.analysis_dir / f"recording-{recording_id}"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"run-{run_id}-scores.npz"
    np.savez_compressed(
        path,
        scores=np.asarray(scores, dtype=np.float32),
        labels=np.asarray(labels, dtype="U64"),
        window_hop_seconds=np.asarray(window_hop_seconds, dtype=np.float32),
        window_seconds=np.asarray(window_seconds, dtype=np.float32),
    )
    return path


def load_score_matrix(path: Path) -> tuple[np.ndarray, list[str], float, float]:
    if not path.is_file():
        raise FileNotFoundError(
            "The saved results for this recording are missing. Find the sounds again."
        )
    with np.load(path, allow_pickle=False) as archive:
        scores = np.asarray(archive["scores"], dtype=np.float32)
        labels = [str(item) for item in archive["labels"].tolist()]
        hop = float(archive["window_hop_seconds"])
        window = float(archive["window_seconds"])
    if scores.ndim != 2 or scores.shape[1] != 521 or scores.shape[0] == 0:
        raise ValueError("The stored score matrix is invalid. Run the analysis again.")
    if not np.isfinite(scores).all():
        raise ValueError("The stored score matrix contains invalid scores.")
    return scores, labels, hop, window


def _insert_analysis(
    connection: sqlite3.Connection,
    run_id: int,
    recording_id: int,
    computation: AnalysisComputation,
    threshold: float,
    duration_seconds: float,
    score_matrix_path: str,
    class_map_sha256: str | None,
    completed_at: str,
    window_seconds: float,
    config_json: str,
) -> None:
    connection.executemany(
        """
        INSERT INTO class_statistics(
            analysis_run_id, class_index, class_label, detection_rate,
            detected_windows, window_count, threshold, peak_score, mean_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                run_id,
                item.class_index,
                item.label,
                item.detection_rate,
                item.detected_windows,
                item.window_count,
                threshold,
                item.peak_score,
                item.mean_score,
            )
            for item in computation.class_stats
        ],
    )
    connection.executemany(
        """
        INSERT INTO event_detections(
            analysis_run_id, class_index, class_label, start_seconds,
            end_seconds, model_score, mean_score, window_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                run_id,
                event.class_index,
                event.label,
                event.start_seconds,
                event.end_seconds,
                event.model_score,
                event.mean_score,
                event.window_count,
            )
            for event in computation.events
        ],
    )
    connection.execute(
        """
        UPDATE analysis_runs
           SET status = 'completed', completed_at = ?, error_message = NULL,
               window_count = ?, duration_seconds = ?, score_matrix_path = ?,
               class_map_sha256 = ?, window_seconds = ?, config_json = ?
         WHERE id = ?
        """,
        (
            completed_at,
            computation.window_count,
            duration_seconds,
            score_matrix_path,
            class_map_sha256,
            window_seconds,
            config_json,
            run_id,
        ),
    )
    connection.execute(
        """
        UPDATE recordings
           SET analysis_status = 'completed', analysis_error = NULL, updated_at = ?
         WHERE id = ?
        """,
        (completed_at, recording_id),
    )
    connection.execute(
        """
        UPDATE walk_stops
           SET status = 'analyzed', updated_at = ?
         WHERE recording_id = ?
           AND status IN ('analysis_pending', 'recorded', 'analysis_failed')
        """,
        (completed_at, recording_id),
    )


def perform_analysis(
    settings: Settings,
    engine: YamnetEngine,
    recording_id: int,
    threshold: float,
) -> int:
    """Run a real analysis synchronously. Safe to call from the worker or tests."""
    settings.ensure_directories()
    started_at = utc_now_iso()
    with connect(settings) as connection:
        recording = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not recording:
            raise ValueError(f"Recording {recording_id} does not exist.")
        if recording["analysis_status"] in {"queued", "running"}:
            active = connection.execute(
                """
                SELECT id FROM analysis_runs
                 WHERE recording_id = ? AND status = 'running'
                 ORDER BY id DESC LIMIT 1
                """,
                (recording_id,),
            ).fetchone()
            if active and recording["analysis_status"] == "running":
                return int(active["id"])
        cursor = connection.execute(
            """
            INSERT INTO analysis_runs(
                recording_id, model_name, model_version, threshold,
                started_at, status, window_hop_seconds
            ) VALUES (?, ?, ?, ?, ?, 'running', 0.48)
            """,
            (recording_id, MODEL_NAME, engine.model_version, threshold, started_at),
        )
        run_id = int(cursor.lastrowid)
        connection.execute(
            """
            UPDATE recordings
               SET analysis_status = 'running', analysis_error = NULL, updated_at = ?
             WHERE id = ?
            """,
            (started_at, recording_id),
        )
        connection.commit()
        audio_path = resolve_data_path(settings, recording["internal_audio_path"])

    score_path: Path | None = None
    try:
        if not audio_path.is_file():
            raise FileNotFoundError(
                "The original audio file is missing from the archive."
            )
        waveform, source_sample_rate = decode_mono(audio_path)
        duration_seconds = len(waveform) / YAMNET_SAMPLE_RATE
        minimum = settings.min_duration_seconds
        if duration_seconds < minimum:
            raise AudioValidationError(
                f"This recording is shorter than the {minimum:g} second minimum."
            )
        if duration_seconds > settings.max_duration_seconds + 1.0:
            raise AudioValidationError(
                f"The recording exceeds the {settings.max_duration_seconds:.0f} second limit."
            )
        logger.info(
            "Analyzing recording %s: %.1fs audio, source %s Hz",
            recording_id,
            duration_seconds,
            source_sample_rate,
        )
        prediction = engine.predict(waveform)
        duration_seconds = min(duration_seconds, len(waveform) / YAMNET_SAMPLE_RATE)
        computation = compute_analysis(
            prediction.scores,
            prediction.labels,
            threshold,
            duration_seconds,
            prediction.window_hop_seconds,
            prediction.window_seconds,
        )
        score_path = save_score_matrix(
            settings,
            recording_id,
            run_id,
            prediction.scores,
            prediction.labels,
            prediction.window_hop_seconds,
            prediction.window_seconds,
        )
        relative_path = portable_relative_path(score_path, settings)
        completed_at = utc_now_iso()
        with connect(settings) as connection:
            try:
                _insert_analysis(
                    connection,
                    run_id,
                    recording_id,
                    computation,
                    threshold,
                    duration_seconds,
                    relative_path,
                    engine.class_map_hash,
                    completed_at,
                    float(prediction.window_seconds),
                    json.dumps(
                        {
                            "model_name": MODEL_NAME,
                            "model_version": engine.model_version,
                            "threshold": threshold,
                            "window_hop_seconds": float(prediction.window_hop_seconds),
                            "window_seconds": float(prediction.window_seconds),
                            "input_sample_rate": YAMNET_SAMPLE_RATE,
                            "mono": True,
                            "loudness_normalized": False,
                            "class_map_sha256": engine.class_map_hash,
                        },
                        sort_keys=True,
                    ),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        logger.info(
            "Analysis run %s completed: %s windows in %.1fs",
            run_id,
            computation.window_count,
            prediction.inference_seconds,
        )
        return run_id
    except Exception as exc:  # noqa: BLE001 - persisted as user-visible failure
        message = str(exc).strip() or type(exc).__name__
        if len(message) > 2000:
            message = message[:1997] + "..."
        logger.exception("Analysis run %s failed", run_id)
        with connect(settings) as connection:
            connection.execute(
                """
                UPDATE analysis_runs
                   SET status = 'failed', completed_at = ?, error_message = ?
                 WHERE id = ?
                """,
                (utc_now_iso(), message, run_id),
            )
            failed_at = utc_now_iso()
            connection.execute(
                """
                UPDATE recordings
                   SET analysis_status = 'failed', analysis_error = ?, updated_at = ?
                 WHERE id = ?
                """,
                (message, failed_at, recording_id),
            )
            connection.execute(
                """
                UPDATE walk_stops
                   SET status = 'analysis_failed', updated_at = ?
                 WHERE recording_id = ?
                   AND status IN ('analysis_pending', 'recorded', 'analyzed')
                """,
                (failed_at, recording_id),
            )
            connection.commit()
        if score_path and score_path.exists():
            score_path.unlink(missing_ok=True)
        raise


def latest_run_for_recording(
    connection: sqlite3.Connection, recording_id: int, completed_only: bool = False
) -> sqlite3.Row | None:
    suffix = "AND status = 'completed'" if completed_only else ""
    return connection.execute(
        f"""
        SELECT * FROM analysis_runs
         WHERE recording_id = ? {suffix}
         ORDER BY id DESC LIMIT 1
        """,
        (recording_id,),
    ).fetchone()


def top_classes_for_recording(
    connection: sqlite3.Connection, recording_id: int, limit: int = 3
) -> list[dict]:
    run = latest_run_for_recording(connection, recording_id, completed_only=True)
    if not run:
        return []
    rows = connection.execute(
        """
        SELECT class_index, class_label, detection_rate, peak_score
          FROM class_statistics
         WHERE analysis_run_id = ? AND detected_windows > 0
         ORDER BY detection_rate DESC, peak_score DESC, class_index ASC
         LIMIT ?
        """,
        (run["id"], limit),
    ).fetchall()
    return [
        {
            "class_index": row["class_index"],
            "label": row["class_label"],
            "detection_rate": row["detection_rate"],
            "peak_score": row["peak_score"],
        }
        for row in rows
    ]


def analysis_payload(settings: Settings, recording_id: int) -> dict:
    with connect(settings) as connection:
        recording = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not recording:
            raise KeyError(recording_id)
        run = latest_run_for_recording(connection, recording_id)
        if not run:
            return {
                "recording_id": recording_id,
                "status": recording["analysis_status"],
                "error": recording["analysis_error"],
                "analysis": None,
            }
        if run["status"] != "completed":
            return {
                "recording_id": recording_id,
                "status": recording["analysis_status"],
                "error": run["error_message"] or recording["analysis_error"],
                "analysis": {
                    "id": run["id"],
                    "model_name": run["model_name"],
                    "model_version": run["model_version"],
                    "threshold": run["threshold"],
                    "window_count": run["window_count"],
                    "window_hop_seconds": run["window_hop_seconds"],
                    "duration_seconds": run["duration_seconds"],
                    "started_at": run["started_at"],
                    "completed_at": run["completed_at"],
                    "status": run["status"],
                    "error_message": run["error_message"],
                    "classes": [],
                },
            }
        stats_rows = connection.execute(
            """
            SELECT class_index, class_label, detection_rate, detected_windows,
                   window_count, peak_score, mean_score
              FROM class_statistics
             WHERE analysis_run_id = ? AND detected_windows > 0
             ORDER BY detection_rate DESC, peak_score DESC, class_index ASC
            """,
            (run["id"],),
        ).fetchall()
        event_rows = connection.execute(
            """
            SELECT class_index, start_seconds, end_seconds, model_score,
                   mean_score, window_count
              FROM event_detections
             WHERE analysis_run_id = ?
             ORDER BY class_index, start_seconds
            """,
            (run["id"],),
        ).fetchall()

    events_by_class: dict[int, list[dict]] = {}
    for row in event_rows:
        events_by_class.setdefault(row["class_index"], []).append(
            {
                "start_seconds": row["start_seconds"],
                "end_seconds": row["end_seconds"],
                "model_score": row["model_score"],
                "mean_score": row["mean_score"],
                "window_count": row["window_count"],
            }
        )
    classes = [
        {
            "class_index": row["class_index"],
            "label": row["class_label"],
            "detection_rate": row["detection_rate"],
            "detected_windows": row["detected_windows"],
            "window_count": row["window_count"],
            "peak_score": row["peak_score"],
            "mean_score": row["mean_score"],
            "events": events_by_class.get(row["class_index"], []),
        }
        for row in stats_rows
    ]
    return {
        "recording_id": recording_id,
        "status": recording["analysis_status"],
        "error": recording["analysis_error"],
        "analysis": {
            "id": run["id"],
            "model_name": run["model_name"],
            "model_version": run["model_version"],
            "threshold": run["threshold"],
            "window_count": run["window_count"],
            "window_hop_seconds": run["window_hop_seconds"],
            "duration_seconds": run["duration_seconds"],
            "started_at": run["started_at"],
            "completed_at": run["completed_at"],
            "status": run["status"],
            "error_message": run["error_message"],
            "classes": classes,
        },
    }


def delete_analysis_artifacts(settings: Settings, recording_ids: list[int]) -> list[str]:
    warnings: list[str] = []
    for recording_id in recording_ids:
        directory = settings.analysis_dir / f"recording-{recording_id}"
        if not directory.exists():
            continue
        for child in directory.glob("*"):
            try:
                if child.is_file():
                    child.unlink()
            except OSError as exc:
                warnings.append(f"Could not remove derived file {child.name}: {exc}")
        try:
            directory.rmdir()
        except OSError:
            pass
    return warnings
