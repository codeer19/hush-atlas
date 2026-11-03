from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.config import Settings
from app.db import SCHEMA_VERSION, _columns, init_db


V1_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    recorded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    original_filename TEXT NOT NULL,
    internal_audio_path TEXT NOT NULL UNIQUE,
    audio_format TEXT NOT NULL,
    sample_rate INTEGER NOT NULL,
    channels INTEGER NOT NULL,
    waveform_peaks TEXT NOT NULL,
    source TEXT NOT NULL,
    analysis_status TEXT NOT NULL DEFAULT 'not_analyzed',
    analysis_error TEXT
);

CREATE TABLE analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    model_version TEXT,
    threshold REAL NOT NULL,
    fading_threshold_pp REAL NOT NULL DEFAULT 10.0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    window_count INTEGER NOT NULL DEFAULT 0,
    window_hop_seconds REAL NOT NULL DEFAULT 0.48,
    duration_seconds REAL NOT NULL DEFAULT 0,
    score_matrix_path TEXT,
    class_map_sha256 TEXT
);

CREATE TABLE comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    threshold REAL NOT NULL,
    fading_threshold_pp REAL NOT NULL,
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
"""


def _v1_settings(tmp_path: Path) -> Settings:
    settings = Settings(
        data_dir=tmp_path / "data",
        model_dir=tmp_path / "models",
        database_path=tmp_path / "data" / "archive.sqlite3",
    )
    settings.ensure_directories()
    connection = sqlite3.connect(settings.db_path)
    try:
        connection.executescript(V1_SCHEMA)
        connection.execute(
            "INSERT INTO places(id, name, description, is_demo, created_at, updated_at) "
            "VALUES (1, 'khv', 'Existing user place', 0, '2026-01-01T00:00:00Z', "
            "'2026-01-01T00:00:00Z')"
        )
        connection.execute(
            """
            INSERT INTO recordings(
                id, place_id, title, notes, recorded_at, created_at, updated_at,
                duration_seconds, original_filename, internal_audio_path, audio_format,
                sample_rate, channels, waveform_peaks, source, analysis_status, analysis_error
            ) VALUES (1, 1, 'Old recording', '', '2026-01-02T00:00:00Z',
                '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 1.5, 'old.wav',
                'audio/old.wav', 'WAV', 32000, 1, '[]', 'upload', 'not_analyzed', NULL)
            """
        )
        connection.execute(
            """
            INSERT INTO analysis_runs(
                id, recording_id, model_name, model_version, threshold,
                fading_threshold_pp, started_at, completed_at, status,
                error_message, window_count, window_hop_seconds, duration_seconds,
                score_matrix_path, class_map_sha256
            ) VALUES (1, 1, 'YAMNet (AudioSet)', 'v1', 0.2, 10.0,
                '2026-01-02T00:00:00Z', '2026-01-02T00:00:01Z', 'completed',
                NULL, 1, 0.48, 1.44, NULL, NULL)
            """
        )
        connection.execute(
            """
            INSERT INTO comparisons(
                id, place_id, threshold, fading_threshold_pp, change_threshold_pp,
                baseline_recording_ids, recent_recording_ids, baseline_run_ids,
                recent_run_ids, baseline_group_json, recent_group_json,
                baseline_window_count, recent_window_count, model_name, model_version,
                warnings, summary, input_hash, created_at
            ) VALUES (1, 1, 0.2, 10.0, 10.0, '[1]', '[1]', '[1]', '[1]', '[]', '[]',
                1, 1, 'YAMNet (AudioSet)', 'v1', '[]', '{}', 'old-hash',
                '2026-01-02T00:00:02Z')
            """
        )
        connection.execute("PRAGMA user_version = 1")
        connection.commit()
    finally:
        connection.close()
    return settings


def test_v1_database_upgrades_in_place_without_touching_user_rows(tmp_path: Path) -> None:
    settings = _v1_settings(tmp_path)
    init_db(settings)

    connection = sqlite3.connect(settings.db_path)
    connection.row_factory = sqlite3.Row
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        place = connection.execute("SELECT * FROM places WHERE id = 1").fetchone()
        assert place["name"] == "khv"
        recording = connection.execute(
            "SELECT * FROM recordings WHERE id = 1"
        ).fetchone()
        assert recording["title"] == "Old recording"
        assert recording["walk_stop_id"] is None
        run = connection.execute("SELECT * FROM analysis_runs WHERE id = 1").fetchone()
        assert run["config_json"] == "{}"
        assert run["window_seconds"] == 0.96
        comparison = connection.execute(
            "SELECT * FROM comparisons WHERE id = 1"
        ).fetchone()
        assert comparison["input_hash"] == "old-hash"
        assert comparison["baseline_session_id"] is None
        assert comparison["recent_session_id"] is None

        tables = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        assert {"routes", "route_stops", "walk_sessions", "walk_stops"} <= tables
        assert {
            "walk_stop_id",
        } <= _columns(connection, "recordings")
        assert {"config_json", "window_seconds"} <= _columns(
            connection, "analysis_runs"
        )
        assert {"baseline_session_id", "recent_session_id"} <= _columns(
            connection, "comparisons"
        )
    finally:
        connection.close()

    # Running init_db again is idempotent and preserves the rows.
    init_db(settings)
    connection = sqlite3.connect(settings.db_path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert connection.execute("SELECT COUNT(*) FROM places").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 1
    finally:
        connection.close()


def test_newer_schema_is_refused(tmp_path: Path) -> None:
    settings = _v1_settings(tmp_path)
    connection = sqlite3.connect(settings.db_path)
    try:
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(RuntimeError, match="newer than this application"):
        init_db(settings)
