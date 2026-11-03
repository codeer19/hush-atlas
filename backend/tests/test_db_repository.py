from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.db import connect, resolve_data_path, utc_now_iso
from app.repository import (
    audio_file_path,
    create_place,
    create_recording,
    delete_place,
    delete_recording,
    get_recording,
)
from tests.conftest import make_audio


def add_recording(settings, place_id: int, filename: str = "garden.wav"):
    path = settings.audio_dir / filename
    make_audio(path, seconds=2)
    return create_recording(
        settings,
        place_id=place_id,
        title="Garden morning",
        notes="test",
        recorded_at=datetime(2024, 5, 1, 6, 0, tzinfo=timezone.utc),
        original_filename="original name.wav",
        internal_audio_path=f"audio/{filename}",
        audio_format="WAV",
        sample_rate=32_000,
        channels=1,
        duration_seconds=2.0,
        peaks=[0.1] * 100,
        source="upload",
    )


def test_place_and_recording_relationships(settings) -> None:
    place = create_place(settings, "Courtyard", "Behind the house")
    recording = add_recording(settings, place["id"])
    assert recording["place_id"] == place["id"]
    loaded = get_recording(settings, recording["id"])
    assert loaded is not None
    assert loaded["place_name"] == "Courtyard"
    assert loaded["waveform"]["peaks"] == [0.1] * 100


def test_foreign_key_rejects_unknown_place(settings) -> None:
    with pytest.raises(LookupError):
        add_recording(settings, 999)
    place = create_place(settings, "Valid place")
    recording = add_recording(settings, place["id"], "fk.wav")
    with pytest.raises(sqlite3.IntegrityError):
        with connect(settings) as connection:
            connection.execute(
                "UPDATE recordings SET place_id = 999 WHERE id = ?", (recording["id"],)
            )
            connection.commit()


def test_recording_delete_removes_audio_and_analysis(settings) -> None:
    place = create_place(settings, "Railway")
    recording = add_recording(settings, place["id"], "rail.wav")
    analysis_dir = settings.analysis_dir / f"recording-{recording['id']}"
    analysis_dir.mkdir(parents=True)
    (analysis_dir / "run-1-scores.npz").write_bytes(b"fake")
    audio = settings.audio_dir / "rail.wav"
    assert audio.exists()

    deleted, warnings = delete_recording(settings, recording["id"])
    assert deleted is True
    assert warnings == []
    assert not audio.exists()
    assert not analysis_dir.exists()
    assert get_recording(settings, recording["id"]) is None


def test_place_delete_removes_children_and_files(settings) -> None:
    place = create_place(settings, "Market")
    first = add_recording(settings, place["id"], "market1.wav")
    second = add_recording(settings, place["id"], "market2.wav")
    for recording in (first, second):
        (settings.analysis_dir / f"recording-{recording['id']}").mkdir(parents=True)

    deleted, warnings = delete_place(settings, place["id"])
    assert deleted is True
    assert warnings == []
    assert not (settings.audio_dir / "market1.wav").exists()
    assert not (settings.audio_dir / "market2.wav").exists()
    assert not (settings.analysis_dir / f"recording-{first['id']}").exists()
    with connect(settings) as connection:
        assert connection.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 0


def test_deleting_place_cascades_analysis_rows(settings) -> None:
    place = create_place(settings, "Station")
    recording = add_recording(settings, place["id"])
    with connect(settings) as connection:
        cursor = connection.execute(
            """
            INSERT INTO analysis_runs(
                recording_id, model_name, model_version, threshold, started_at, status,
                window_count, window_hop_seconds
            ) VALUES (?, 'YAMNet', 'test', 0.2, ?, 'completed', 4, 0.48)
            """,
            (recording["id"], utc_now_iso()),
        )
        run_id = cursor.lastrowid
        connection.execute(
            """
            INSERT INTO event_detections(
                analysis_run_id, class_index, class_label, start_seconds, end_seconds,
                model_score, mean_score, window_count
            ) VALUES (?, 0, 'Speech', 0.0, 1.0, 0.5, 0.4, 1)
            """,
            (run_id,),
        )
        connection.commit()
    delete_place(settings, place["id"])
    with connect(settings) as connection:
        assert connection.execute("SELECT COUNT(*) FROM analysis_runs").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM event_detections").fetchone()[0] == 0


def test_path_traversal_is_rejected(settings, tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        resolve_data_path(settings, "../outside.wav")
    with pytest.raises(ValueError):
        resolve_data_path(settings, str(tmp_path / "absolute.wav"))
    place = create_place(settings, "Traversal")
    recording = add_recording(settings, place["id"])
    with connect(settings) as connection:
        connection.execute(
            "UPDATE recordings SET internal_audio_path = '../secret.wav' WHERE id = ?",
            (recording["id"],),
        )
        connection.commit()
    with pytest.raises(ValueError):
        audio_file_path(settings, recording["id"])


def test_missing_audio_file_returns_none(settings) -> None:
    place = create_place(settings, "Missing")
    recording = add_recording(settings, place["id"])
    (settings.audio_dir / "garden.wav").unlink()
    assert audio_file_path(settings, recording["id"]) is None


def test_status_check_constraint(settings) -> None:
    place = create_place(settings, "Constraint")
    recording = add_recording(settings, place["id"])
    with pytest.raises(sqlite3.IntegrityError):
        with connect(settings) as connection:
            connection.execute(
                "UPDATE recordings SET analysis_status = 'made_up' WHERE id = ?",
                (recording["id"],),
            )
            connection.commit()
