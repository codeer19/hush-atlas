from __future__ import annotations

from pathlib import Path

import numpy as np

from app.analysis import save_score_matrix
from app.db import connect, portable_relative_path, utc_now_iso
from tests.conftest import make_audio


ALL_LABELS = [f"Class {index}" for index in range(521)]


def _upload(client, place_id: int, tmp_path: Path, name: str) -> int:
    path = make_audio(tmp_path / name, seconds=2.0)
    with path.open("rb") as handle:
        response = client.post(
            f"/api/places/{place_id}/recordings",
            files={"file": (name, handle, "audio/wav")},
            data={"title": name, "recorded_at": "2024-01-01T06:00:00Z"},
        )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _mark_analyzed(settings, recording_id: int, rate: float, class_index: int = 100) -> int:
    windows = 10
    scores = np.zeros((windows, 521), dtype=np.float32)
    scores[: int(rate * windows), class_index] = 0.9
    with connect(settings) as connection:
        cursor = connection.execute(
            """
            INSERT INTO analysis_runs(
                recording_id, model_name, model_version, threshold, started_at,
                completed_at, status, window_count, window_hop_seconds, duration_seconds
            ) VALUES (?, 'YAMNet (AudioSet)', 'test-version', 0.2, ?, ?, 'completed', ?, 0.48, ?)
            """,
            (recording_id, utc_now_iso(), utc_now_iso(), windows, windows * 0.48 + 0.5),
        )
        run_id = int(cursor.lastrowid)
        detected_windows = int(rate * windows)
        connection.execute(
            """
            INSERT INTO class_statistics(
                analysis_run_id, class_index, class_label, detection_rate,
                detected_windows, window_count, threshold, peak_score, mean_score
            ) VALUES (?, ?, ?, ?, ?, ?, 0.2, ?, ?)
            """,
            (
                run_id,
                class_index,
                ALL_LABELS[class_index],
                rate,
                detected_windows,
                windows,
                0.9 if detected_windows else 0.0,
                0.9 * rate,
            ),
        )
        if detected_windows:
            connection.execute(
                """
                INSERT INTO event_detections(
                    analysis_run_id, class_index, class_label, start_seconds,
                    end_seconds, model_score, mean_score, window_count
                ) VALUES (?, ?, ?, 0.0, ?, 0.9, 0.9, ?)
                """,
                (
                    run_id,
                    class_index,
                    ALL_LABELS[class_index],
                    (detected_windows - 1) * 0.48 + 0.96,
                    detected_windows,
                ),
            )
        connection.commit()
    path = save_score_matrix(settings, recording_id, run_id, scores, ALL_LABELS, 0.48, 0.96)
    with connect(settings) as connection:
        connection.execute(
            "UPDATE analysis_runs SET score_matrix_path = ? WHERE id = ?",
            (portable_relative_path(path, settings), run_id),
        )
        connection.execute(
            "UPDATE recordings SET analysis_status = 'completed' WHERE id = ?",
            (recording_id,),
        )
        connection.commit()
    return run_id


def test_comparison_api_end_to_end_without_model_mock(client, settings, tmp_path: Path) -> None:
    place = client.post(
        "/api/places", json={"name": "Comparison Garden", "description": "Test"}
    ).json()
    baseline_id = _upload(client, place["id"], tmp_path, "baseline.wav")
    recent_id = _upload(client, place["id"], tmp_path, "recent.wav")
    _mark_analyzed(settings, baseline_id, 0.8)
    _mark_analyzed(settings, recent_id, 0.1)

    response = client.post(
        "/api/comparisons",
        json={
            "place_id": place["id"],
            "baseline_recording_ids": [baseline_id],
            "recent_recording_ids": [recent_id],
            "threshold": 0.2,
            "fading_threshold_pp": 10,
        },
    )
    assert response.status_code == 201, response.text
    comparison = response.json()
    assert comparison["summary"]["fading_count"] == 1
    assert comparison["reliability"] == "limited"
    result = next(item for item in comparison["results"] if item["class_index"] == 100)
    assert result["baseline_rate"] == 0.8
    assert result["recent_rate"] == 0.1
    assert result["difference_pp"] == -70.0
    assert result["classification"] == "detected_less"
    assert result["fading"] is True
    assert result["baseline_recording_rates"][0]["peak_window_start"] is not None

    fetched = client.get(f"/api/comparisons/{comparison['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["input_hash"] == comparison["input_hash"]
    listing = client.get(f"/api/comparisons?place_id={place['id']}")
    assert listing.status_code == 200
    assert listing.json()[0]["fading_count"] == 1

    overview = client.get("/api/overview").json()
    assert overview["place_count"] == 1
    assert overview["recording_count"] == 2
    assert overview["analyzed_count"] == 2
    assert overview["notable_changes"][0]["label"] == "Class 100"

    reflection = client.get(
        f"/api/comparisons/{comparison['id']}/reflection/100"
    )
    assert reflection.status_code == 200
    assert reflection.json()["source"] == "deterministic-fallback"
    assert reflection.json()["model_name"] is None
    assert "80.0%" in reflection.json()["text"]

    map_response = client.get(f"/api/places/{place['id']}/map")
    assert map_response.status_code == 200
    assert map_response.json()["note"].startswith("A map of the sounds")

    # Evidence audio is still available through the snapshot.
    audio = client.get(f"/api/recordings/{baseline_id}/audio")
    assert audio.status_code == 200
    assert len(audio.content) > 1000


def test_comparison_rejects_mixed_places(client, settings, tmp_path: Path) -> None:
    first_place = client.post("/api/places", json={"name": "First"}).json()
    second_place = client.post("/api/places", json={"name": "Second"}).json()
    first = _upload(client, first_place["id"], tmp_path, "first.wav")
    second = _upload(client, second_place["id"], tmp_path, "second.wav")
    _mark_analyzed(settings, first, 0.5)
    _mark_analyzed(settings, second, 0.2)
    response = client.post(
        "/api/comparisons",
        json={
            "place_id": first_place["id"],
            "baseline_recording_ids": [first],
            "recent_recording_ids": [second],
        },
    )
    assert response.status_code == 422
    assert "same place" in response.json()["detail"].lower()
