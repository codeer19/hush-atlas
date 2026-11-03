"""SQLite persistence for Hush Atlas.

The schema keeps raw evidence reproducible:
* score matrices are stored as compressed NumPy arrays outside SQLite;
* per-window detections and per-class window shares live in SQLite;
* comparisons store their selected runs, threshold and per-recording rates.

Schema versions are additive. The v1 archive database is upgraded in place; no
table is dropped and no existing row is rewritten during migration.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .config import Settings


SCHEMA_VERSION = 2

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 8000),
    recorded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
    original_filename TEXT NOT NULL,
    internal_audio_path TEXT NOT NULL UNIQUE,
    audio_format TEXT NOT NULL,
    sample_rate INTEGER NOT NULL CHECK (sample_rate > 0),
    channels INTEGER NOT NULL CHECK (channels > 0),
    waveform_peaks TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('upload', 'browser_recording')),
    analysis_status TEXT NOT NULL DEFAULT 'not_analyzed'
        CHECK (analysis_status IN ('not_analyzed','queued','running','completed','failed')),
    analysis_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_recordings_place ON recordings(place_id);
CREATE INDEX IF NOT EXISTS idx_recordings_recorded_at ON recordings(recorded_at);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(analysis_status);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    model_version TEXT,
    threshold REAL NOT NULL CHECK (threshold > 0 AND threshold < 1),
    fading_threshold_pp REAL NOT NULL DEFAULT 10.0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
    error_message TEXT,
    window_count INTEGER NOT NULL DEFAULT 0 CHECK (window_count >= 0),
    window_hop_seconds REAL NOT NULL DEFAULT 0.48,
    duration_seconds REAL NOT NULL DEFAULT 0,
    score_matrix_path TEXT,
    class_map_sha256 TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_recording ON analysis_runs(recording_id);
CREATE INDEX IF NOT EXISTS idx_analysis_status ON analysis_runs(status);

CREATE TABLE IF NOT EXISTS event_detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    class_index INTEGER NOT NULL CHECK (class_index BETWEEN 0 AND 520),
    class_label TEXT NOT NULL,
    start_seconds REAL NOT NULL CHECK (start_seconds >= 0),
    end_seconds REAL NOT NULL CHECK (end_seconds >= 0),
    model_score REAL NOT NULL CHECK (model_score >= 0 AND model_score <= 1),
    mean_score REAL NOT NULL CHECK (mean_score >= 0 AND mean_score <= 1),
    window_count INTEGER NOT NULL CHECK (window_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_events_run_class ON event_detections(analysis_run_id, class_index);
CREATE INDEX IF NOT EXISTS idx_events_start ON event_detections(start_seconds);

CREATE TABLE IF NOT EXISTS class_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    class_index INTEGER NOT NULL CHECK (class_index BETWEEN 0 AND 520),
    class_label TEXT NOT NULL,
    detection_rate REAL NOT NULL CHECK (detection_rate >= 0 AND detection_rate <= 1),
    detected_windows INTEGER NOT NULL CHECK (detected_windows >= 0),
    window_count INTEGER NOT NULL CHECK (window_count > 0),
    threshold REAL NOT NULL CHECK (threshold > 0 AND threshold < 1),
    peak_score REAL NOT NULL CHECK (peak_score >= 0 AND peak_score <= 1),
    mean_score REAL NOT NULL CHECK (mean_score >= 0 AND mean_score <= 1),
    UNIQUE(analysis_run_id, class_index)
);

CREATE INDEX IF NOT EXISTS idx_stats_run_rate ON class_statistics(analysis_run_id, detection_rate);

CREATE TABLE IF NOT EXISTS comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    threshold REAL NOT NULL CHECK (threshold > 0 AND threshold < 1),
    fading_threshold_pp REAL NOT NULL CHECK (fading_threshold_pp > 0),
    change_threshold_pp REAL NOT NULL DEFAULT 10.0,
    baseline_recording_ids TEXT NOT NULL,
    recent_recording_ids TEXT NOT NULL,
    baseline_run_ids TEXT NOT NULL,
    recent_run_ids TEXT NOT NULL,
    baseline_group_json TEXT NOT NULL DEFAULT '[]',
    recent_group_json TEXT NOT NULL DEFAULT '[]',
    baseline_window_count INTEGER NOT NULL DEFAULT 0,
    recent_window_count INTEGER NOT NULL DEFAULT 0,
    model_name TEXT NOT NULL,
    model_version TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    input_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comparisons_place ON comparisons(place_id);
CREATE INDEX IF NOT EXISTS idx_comparisons_created ON comparisons(created_at);

CREATE TABLE IF NOT EXISTS comparison_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comparison_id INTEGER NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
    class_index INTEGER NOT NULL CHECK (class_index BETWEEN 0 AND 520),
    class_label TEXT NOT NULL,
    baseline_rate REAL NOT NULL CHECK (baseline_rate >= 0 AND baseline_rate <= 1),
    recent_rate REAL NOT NULL CHECK (recent_rate >= 0 AND recent_rate <= 1),
    difference_pp REAL NOT NULL,
    baseline_detected_windows INTEGER NOT NULL,
    recent_detected_windows INTEGER NOT NULL,
    classification TEXT NOT NULL CHECK (classification IN
        ('detected_more','detected_less','similar','newly_detected','not_detected')),
    fading INTEGER NOT NULL DEFAULT 0 CHECK (fading IN (0,1)),
    baseline_recording_rates TEXT NOT NULL DEFAULT '[]',
    recent_recording_rates TEXT NOT NULL DEFAULT '[]',
    evidence TEXT NOT NULL DEFAULT '{}',
    UNIQUE(comparison_id, class_index)
);

CREATE INDEX IF NOT EXISTS idx_results_comparison ON comparison_results(comparison_id);
CREATE INDEX IF NOT EXISTS idx_results_fading ON comparison_results(comparison_id, fading);

CREATE TABLE IF NOT EXISTS reflections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comparison_id INTEGER NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
    class_index INTEGER NOT NULL CHECK (class_index BETWEEN 0 AND 520),
    input_hash TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('gemma','deterministic-fallback')),
    model_name TEXT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(comparison_id, class_index)
);

CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
    recording_duration_seconds REAL NOT NULL DEFAULT 30
        CHECK (recording_duration_seconds BETWEEN 5 AND 180),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routes_place ON routes(place_id);
CREATE INDEX IF NOT EXISTS idx_routes_updated ON routes(updated_at);

CREATE TABLE IF NOT EXISTS route_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_order INTEGER NOT NULL CHECK (stop_order >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
    latitude REAL CHECK (latitude BETWEEN -90 AND 90),
    longitude REAL CHECK (longitude BETWEEN -180 AND 180),
    UNIQUE(route_id, stop_order)
);

CREATE INDEX IF NOT EXISTS idx_route_stops_route ON route_stops(route_id, stop_order);

CREATE TABLE IF NOT EXISTS walk_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_key TEXT NOT NULL,
    route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed')),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
    started_at TEXT NOT NULL,
    paused_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_walk_sessions_place ON walk_sessions(place_id);
CREATE INDEX IF NOT EXISTS idx_walk_sessions_route ON walk_sessions(route_id);
CREATE INDEX IF NOT EXISTS idx_walk_sessions_status ON walk_sessions(status);

CREATE TABLE IF NOT EXISTS walk_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES walk_sessions(id) ON DELETE CASCADE,
    route_stop_id INTEGER REFERENCES route_stops(id) ON DELETE SET NULL,
    stop_order INTEGER NOT NULL CHECK (stop_order >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    latitude REAL CHECK (latitude BETWEEN -90 AND 90),
    longitude REAL CHECK (longitude BETWEEN -180 AND 180),
    observation TEXT NOT NULL DEFAULT '' CHECK (length(observation) <= 2000),
    status TEXT NOT NULL DEFAULT 'ready_to_listen'
        CHECK (status IN (
            'ready_to_listen','listening','ready_to_record','recording',
            'recorded','analysis_pending','analyzed','analysis_failed',
            'reviewed','completed'
        )),
    recording_id INTEGER REFERENCES recordings(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(session_id, stop_order)
);

CREATE INDEX IF NOT EXISTS idx_walk_stops_session ON walk_stops(session_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_walk_stops_recording ON walk_stops(recording_id);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(row["name"])
        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }


def _add_column(connection: sqlite3.Connection, table: str, definition: str) -> None:
    column = definition.split()[0]
    if column not in _columns(connection, table):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def _migrate_v2(connection: sqlite3.Connection) -> None:
    """Add walk-session, route and fingerprint links without touching user rows."""
    _add_column(
        connection,
        "recordings",
        "walk_stop_id INTEGER REFERENCES walk_stops(id) ON DELETE SET NULL",
    )
    _add_column(
        connection,
        "analysis_runs",
        "config_json TEXT NOT NULL DEFAULT '{}'",
    )
    _add_column(
        connection,
        "analysis_runs",
        "window_seconds REAL NOT NULL DEFAULT 0.96",
    )
    _add_column(
        connection,
        "comparisons",
        "baseline_session_id INTEGER REFERENCES walk_sessions(id) ON DELETE SET NULL",
    )
    _add_column(
        connection,
        "comparisons",
        "recent_session_id INTEGER REFERENCES walk_sessions(id) ON DELETE SET NULL",
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_recordings_walk_stop ON recordings(walk_stop_id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_comparisons_sessions "
        "ON comparisons(baseline_session_id, recent_session_id)"
    )


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


@contextmanager
def connect(settings: Settings) -> Iterator[sqlite3.Connection]:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.db_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    try:
        yield connection
    finally:
        connection.close()


def init_db(settings: Settings) -> None:
    settings.ensure_directories()
    with connect(settings) as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema version {version} is newer than this application supports "
                f"({SCHEMA_VERSION})."
            )
        connection.executescript(SCHEMA)
        if version < 2:
            _migrate_v2(connection)
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        connection.commit()


def recover_interrupted_jobs(settings: Settings) -> None:
    """Mark analyses that were interrupted by an app shutdown as failed."""
    with connect(settings) as connection:
        now = utc_now_iso()
        connection.execute(
            """
            UPDATE recordings
               SET analysis_status = 'failed',
                   analysis_error = COALESCE(analysis_error,
                       'The sound search stopped when the app closed. Run it again.'),
                   updated_at = ?
             WHERE analysis_status IN ('queued', 'running')
            """,
            (now,),
        )
        connection.execute(
            """
            UPDATE analysis_runs
               SET status = 'failed',
                   completed_at = ?,
                   error_message = COALESCE(error_message,
                       'The sound search stopped when the app closed.')
             WHERE status = 'running'
            """,
            (now,),
        )
        connection.commit()


def get_setting(settings: Settings, key: str, default: str | None = None) -> str | None:
    with connect(settings) as connection:
        row = connection.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(settings: Settings, key: str, value: str) -> None:
    with connect(settings) as connection:
        connection.execute(
            """
            INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, utc_now_iso()),
        )
        connection.commit()


def delete_setting(settings: Settings, key: str) -> None:
    with connect(settings) as connection:
        connection.execute("DELETE FROM app_settings WHERE key = ?", (key,))
        connection.commit()


def db_is_healthy(settings: Settings) -> bool:
    try:
        with connect(settings) as connection:
            connection.execute("SELECT 1 FROM places LIMIT 1").fetchone()
        return True
    except sqlite3.Error:
        return False


def portable_relative_path(path: Path, settings: Settings) -> str:
    """Return a path relative to the data directory, refusing escapes."""
    resolved = path.resolve()
    root = settings.data_dir.resolve()
    try:
        relative = resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("Derived file path is outside the application data directory.") from exc
    return relative.as_posix()


def resolve_data_path(settings: Settings, relative_path: str) -> Path:
    """Resolve a stored relative path without allowing traversal outside data/."""
    if not relative_path or Path(relative_path).is_absolute():
        raise ValueError("Stored file path must be relative.")
    candidate = (settings.data_dir / relative_path).resolve()
    root = settings.data_dir.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Stored file path escapes the application data directory.")
    return candidate
