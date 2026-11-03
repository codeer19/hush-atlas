from __future__ import annotations

from pathlib import Path

from app.db import connect, utc_now_iso
from tests.conftest import make_audio
from tests.test_api_integration import _mark_analyzed


def _create_place(client, name: str = "Walk Garden") -> int:
    response = client.post(
        "/api/places",
        json={"name": name, "description": "A place for a listening walk."},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def _create_walk(
    client,
    place_id: int,
    *,
    title: str = "First listening walk",
    mission_key: str = "five-sounds",
    stops: list[dict] | None = None,
) -> dict:
    response = client.post(
        "/api/walks",
        json={
            "mission_key": mission_key,
            "place_id": place_id,
            "title": title,
            "notes": "A short test route.",
            "stops": stops
            or [
                {"name": "The gate", "notes": "Start here."},
                {"name": "The bench", "latitude": 51.5, "longitude": -0.12},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _upload_to_stop(
    client,
    session_id: int,
    stop_id: int,
    tmp_path: Path,
    name: str,
) -> dict:
    path = make_audio(tmp_path / name, seconds=2.0)
    with path.open("rb") as handle:
        response = client.post(
            f"/api/walks/{session_id}/stops/{stop_id}/recording",
            files={"file": (name, handle, "audio/wav")},
            data={
                "title": f"Stop recording {name}",
                "recorded_at": "2026-04-10T09:00:00Z",
                "source": "browser_recording",
            },
        )
    assert response.status_code == 201, response.text
    return response.json()


def _mark_recording_failed(settings, recording_id: int, message: str) -> None:
    with connect(settings) as connection:
        connection.execute(
            """
            UPDATE recordings
               SET analysis_status = 'failed', analysis_error = ?, updated_at = ?
             WHERE id = ?
            """,
            (message, utc_now_iso(), recording_id),
        )
        connection.commit()


def test_missions_endpoint_lists_real_missions(client) -> None:
    response = client.get("/api/missions")
    assert response.status_code == 200
    missions = response.json()
    assert [mission["key"] for mission in missions] == [
        "five-sounds",
        "two-moments",
        "find-the-quiet",
    ]
    for mission in missions:
        assert mission["title"]
        assert mission["short_description"]
        assert mission["purpose"]
        assert mission["what_you_will_do"]
        assert mission["default_stop_names"]
        assert (
            mission["minimum_stops"]
            <= mission["suggested_stops"]
            <= mission["maximum_stops"]
        )
        assert mission["duration_is_estimate"] is True


def test_unknown_mission_is_a_validation_error(client) -> None:
    place_id = _create_place(client)
    response = client.post(
        "/api/walks",
        json={
            "mission_key": "not-a-mission",
            "place_id": place_id,
            "stops": [{"name": "The gate"}],
        },
    )
    assert response.status_code == 422
    assert "unknown soundwalk mission" in response.json()["detail"].lower()


def test_walk_lifecycle_gates_recording_and_preserves_failed_audio(
    client, settings, tmp_path: Path
) -> None:
    place_id = _create_place(client)
    walk = _create_walk(client, place_id)

    assert walk["status"] == "active"
    assert walk["route_id"] is not None
    assert [stop["name"] for stop in walk["stops"]] == ["The gate", "The bench"]
    assert all(stop["status"] == "ready_to_listen" for stop in walk["stops"])
    assert walk["progress"] == {
        "total_stops": 2,
        "recorded_stops": 0,
        "analyzed_stops": 0,
        "failed_analysis_stops": 0,
        "reviewed_stops": 0,
        "remaining_stops": 2,
    }

    route = client.get(f"/api/routes/{walk['route_id']}")
    assert route.status_code == 200
    route_body = route.json()
    assert [stop["name"] for stop in route_body["stops"]] == ["The gate", "The bench"]
    assert route_body["stops"][1]["latitude"] == 51.5
    assert route_body["stops"][1]["longitude"] == -0.12

    session_id = walk["id"]
    stop_id = walk["stops"][0]["id"]

    # A stop cannot jump to recorded without a saved clip.
    blocked = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}", json={"status": "recorded"}
    )
    assert blocked.status_code == 422
    assert "save a recording" in blocked.json()["detail"].lower()

    listening = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}",
        json={"status": "listening", "observation": "A gate hinge, then traffic."},
    )
    assert listening.status_code == 200
    assert listening.json()["status"] == "listening"
    assert listening.json()["observation"] == "A gate hinge, then traffic."

    ready = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}", json={"status": "ready_to_record"}
    )
    assert ready.status_code == 200

    paused = client.patch(f"/api/walks/{session_id}", json={"status": "paused"})
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert paused.json()["paused_at"] is not None

    refused = client.post(
        f"/api/walks/{session_id}/stops/{stop_id}/recording",
        files={"file": ("paused.wav", b"not audio", "audio/wav")},
        data={"recorded_at": "2026-04-10T09:00:00Z"},
    )
    assert refused.status_code == 409
    assert "resume" in refused.json()["detail"].lower()

    resumed = client.patch(f"/api/walks/{session_id}", json={"status": "active"})
    assert resumed.status_code == 200
    assert resumed.json()["paused_at"] is None

    recording = _upload_to_stop(client, session_id, stop_id, tmp_path, "gate.wav")
    walk_after_upload = client.get(f"/api/walks/{session_id}").json()
    stop_after_upload = walk_after_upload["stops"][0]
    assert stop_after_upload["status"] == "recorded"
    assert stop_after_upload["recording"]["id"] == recording["id"]
    assert stop_after_upload["observation"] == "A gate hinge, then traffic."
    assert walk_after_upload["progress"]["recorded_stops"] == 1

    _mark_recording_failed(settings, recording["id"], "Synthetic test failure")
    failed = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}", json={"status": "analysis_failed"}
    )
    assert failed.status_code == 200
    walk_failed = client.get(f"/api/walks/{session_id}").json()
    assert walk_failed["progress"]["failed_analysis_stops"] == 1
    failed_stop = walk_failed["stops"][0]
    assert failed_stop["recording"]["analysis_status"] == "failed"
    assert failed_stop["recording"]["analysis_error"] == "Synthetic test failure"
    assert failed_stop["observation"] == "A gate hinge, then traffic."

    # The audio survives a failed analysis and is still downloadable.
    assert client.get(f"/api/recordings/{recording['id']}").status_code == 200
    audio = client.get(f"/api/recordings/{recording['id']}/audio")
    assert audio.status_code == 200
    assert len(audio.content) > 1000

    analyzed_too_early = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}", json={"status": "analyzed"}
    )
    assert analyzed_too_early.status_code == 422
    assert "completed sound analysis" in analyzed_too_early.json()["detail"].lower()

    _mark_analyzed(settings, recording["id"], 0.4)
    analyzed = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}", json={"status": "analyzed"}
    )
    assert analyzed.status_code == 200
    reviewed = client.patch(
        f"/api/walks/{session_id}/stops/{stop_id}", json={"status": "reviewed"}
    )
    assert reviewed.status_code == 200
    assert client.get(f"/api/walks/{session_id}").json()["progress"][
        "reviewed_stops"
    ] == 1

    completed = client.patch(f"/api/walks/{session_id}", json={"status": "completed"})
    assert completed.status_code == 200
    assert completed.json()["completed_at"] is not None

    map_response = client.get(f"/api/walks/{session_id}/map")
    assert map_response.status_code == 200
    map_body = map_response.json()
    assert len(map_body["stops"]) == 2
    assert map_body["has_coordinates"] is True
    assert "ordered route diagram" in map_body["note"].lower()
    assert "no tiles" in map_body["note"].lower()
    assert map_body["stops"][0]["observation"] == "A gate hinge, then traffic."

    report = client.get(f"/api/walks/{session_id}/report")
    assert report.status_code == 200
    assert "First listening walk" in report.text
    assert "A gate hinge, then traffic." in report.text
    assert "Synthetic test failure" in report.text


def test_repeat_walk_comparison_evidence_and_reports(
    client, settings, tmp_path: Path
) -> None:
    place_id = _create_place(client, "Repeat Garden")
    baseline = _create_walk(client, place_id, title="Baseline visit")
    baseline_id = baseline["id"]

    baseline_recordings = []
    for index, stop in enumerate(baseline["stops"]):
        recording = _upload_to_stop(
            client, baseline_id, stop["id"], tmp_path, f"baseline-{index}.wav"
        )
        _mark_analyzed(settings, recording["id"], 0.8 if index == 0 else 0.1)
        baseline_recordings.append(recording)
        updated = client.patch(
            f"/api/walks/{baseline_id}/stops/{stop['id']}",
            json={"status": "analyzed", "observation": f"Baseline note {index}."},
        )
        assert updated.status_code == 200, updated.text

    assert client.patch(
        f"/api/walks/{baseline_id}", json={"status": "completed"}
    ).status_code == 200

    repeated = client.post(f"/api/walks/{baseline_id}/repeat")
    assert repeated.status_code == 201, repeated.text
    repeat_body = repeated.json()
    repeat_id = repeat_body["id"]
    assert repeat_id != baseline_id
    assert repeat_body["route_id"] == baseline["route_id"]
    assert repeat_body["status"] == "active"
    assert all(stop["status"] == "ready_to_listen" for stop in repeat_body["stops"])
    assert repeat_body["previous_visit"]["id"] == baseline_id
    assert repeat_body["previous_visit"]["title"] == "Baseline visit"

    recent_recordings = []
    for index, stop in enumerate(repeat_body["stops"]):
        recording = _upload_to_stop(
            client, repeat_id, stop["id"], tmp_path, f"recent-{index}.wav"
        )
        _mark_analyzed(settings, recording["id"], 0.2 if index == 0 else 0.7)
        recent_recordings.append(recording)
        updated = client.patch(
            f"/api/walks/{repeat_id}/stops/{stop['id']}",
            json={"status": "analyzed", "observation": f"Recent note {index}."},
        )
        assert updated.status_code == 200, updated.text

    preview = client.get(
        f"/api/walks/{repeat_id}/comparison-preview?other_session_id={baseline_id}"
    )
    assert preview.status_code == 200, preview.text
    preview_body = preview.json()
    assert preview_body["other_session_id"] == baseline_id
    assert preview_body["other_session_title"] == "Baseline visit"
    assert preview_body["comparable_pairs"] == 2
    assert [pair["status"] for pair in preview_body["pairs"]] == [
        "comparable",
        "comparable",
    ]
    assert preview_body["pairs"][0]["baseline_recording"]["id"] == baseline_recordings[0]["id"]
    assert preview_body["pairs"][0]["recent_recording"]["id"] == recent_recordings[0]["id"]

    comparison = client.post(
        f"/api/walks/{repeat_id}/compare",
        json={"other_session_id": baseline_id, "threshold": 0.2},
    )
    assert comparison.status_code == 201, comparison.text
    comparison_body = comparison.json()
    comparison_id = comparison_body["id"]
    assert comparison_body["baseline_session_id"] == baseline_id
    assert comparison_body["recent_session_id"] == repeat_id
    assert comparison_body["place_id"] == place_id
    assert len(comparison_body["stop_context"]) == 4
    assert {item["session_id"] for item in comparison_body["stop_context"]} == {
        baseline_id,
        repeat_id,
    }
    result = next(
        item for item in comparison_body["results"] if item["class_index"] == 100
    )
    assert result["baseline_rate"] == 0.45
    assert result["recent_rate"] == 0.45

    evidence = client.get(f"/api/comparisons/{comparison_id}/evidence/100")
    assert evidence.status_code == 200, evidence.text
    evidence_body = evidence.json()
    assert evidence_body["result"]["class_index"] == 100
    assert len(evidence_body["baseline_recordings"]) == 2
    assert len(evidence_body["recent_recordings"]) == 2
    assert evidence_body["baseline_recordings"][0]["stop_context"]["stop_name"]
    assert evidence_body["evidence_notes"]

    fingerprint = client.get(
        f"/api/recordings/{baseline_recordings[0]['id']}/fingerprint"
    )
    assert fingerprint.status_code == 200, fingerprint.text
    fingerprint_body = fingerprint.json()
    assert fingerprint_body["fingerprint"]["class_count"] >= 1
    assert fingerprint_body["stop_context"]["session_id"] == baseline_id

    class_report = client.get(
        f"/api/comparisons/{comparison_id}/report?class_index=100"
    )
    assert class_report.status_code == 200
    assert "Class 100" in class_report.text
    assert "Baseline" in class_report.text or "baseline" in class_report.text

    full_report = client.get(f"/api/comparisons/{comparison_id}/report")
    assert full_report.status_code == 200
    assert "comparison" in full_report.text.lower()

    # Deleting the repeat walk keeps its recordings in the archive.
    deleted = client.delete(f"/api/walks/{repeat_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/recordings/{recent_recordings[0]['id']}").status_code == 200
    assert client.get(f"/api/walks/{baseline_id}").status_code == 200
    assert client.get(f"/api/walks/{repeat_id}").status_code == 404


def test_comparison_preview_reports_missing_evidence(client) -> None:
    place_id = _create_place(client, "Preview Garden")
    walk = _create_walk(client, place_id)
    preview = client.get(f"/api/walks/{walk['id']}/comparison-preview")
    assert preview.status_code == 200
    body = preview.json()
    assert body["comparable_pairs"] == 0
    assert all(pair["status"] == "missing" for pair in body["pairs"])
    assert body["warnings"]
