from __future__ import annotations

import io
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.db import connect
from app.main import create_app
from tests.conftest import make_audio


def create_place(client, name: str = "Test Garden") -> dict:
    response = client.post("/api/places", json={"name": name, "description": "A local place"})
    assert response.status_code == 201
    return response.json()


def upload(client, place_id: int, tmp_path: Path, filename: str = "garden.wav") -> dict:
    path = make_audio(tmp_path / filename, seconds=2.5)
    with path.open("rb") as handle:
        response = client.post(
            f"/api/places/{place_id}/recordings",
            files={"file": (filename, handle, "audio/wav")},
            data={
                "title": "Morning garden",
                "notes": "Wind and birds",
                "recorded_at": "2024-05-01T06:30:00Z",
                "source": "upload",
            },
        )
    assert response.status_code == 201, response.text
    return response.json()


def test_health_reports_local_and_database(client) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["local_only"] is True
    assert data["database"] is True
    assert data["audio_model_assets"] is False


def test_health_reports_hosted_mode(settings: Settings) -> None:
    hosted_settings = settings.model_copy(update={"hosted": True})
    app = create_app(hosted_settings)
    with TestClient(app) as hosted_client:
        response = hosted_client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] is True
    assert data["local_only"] is False


def test_health_returns_503_when_database_is_unhealthy(client, monkeypatch) -> None:
    monkeypatch.setattr("app.routes.db_is_healthy", lambda _settings: False)
    response = client.get("/api/health")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "degraded"
    assert data["database"] is False


def test_place_crud_and_validation(client) -> None:
    assert client.get("/api/places").json() == []
    place = create_place(client)
    assert place["recording_count"] == 0
    updated = client.patch(
        f"/api/places/{place['id']}", json={"name": "Renamed garden", "description": "New"}
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed garden"
    assert client.patch("/api/places/9999", json={"name": "x"}).status_code == 404
    assert client.post("/api/places", json={"name": "   "}).status_code == 422
    assert client.post("/api/places", json={"name": "x" * 121}).status_code == 422
    deleted = client.delete(f"/api/places/{place['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert client.get(f"/api/places/{place['id']}").status_code == 404


def test_upload_recording_and_details(client, settings, tmp_path: Path) -> None:
    place = create_place(client)
    recording = upload(client, place["id"], tmp_path)
    assert recording["duration_seconds"] == 2.5
    assert recording["sample_rate"] == 32_000
    assert recording["audio_format"] == "WAV"
    assert recording["analysis_status"] == "not_analyzed"
    assert recording["recorded_at"].startswith("2024-05-01T06:30:00")

    detail = client.get(f"/api/recordings/{recording['id']}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["waveform"]["peaks"]
    assert len(payload["waveform"]["peaks"]) == 1200
    assert payload["audio_url"] == f"/api/recordings/{recording['id']}/audio"
    assert payload["place_name"] == "Test Garden"

    audio = client.get(payload["audio_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"].startswith("audio/wav")
    ranged = client.get(payload["audio_url"], headers={"Range": "bytes=0-99"})
    assert ranged.status_code == 206
    assert len(ranged.content) == 100
    assert ranged.headers["content-range"].startswith("bytes 0-99/")

    waveform = client.get(f"/api/recordings/{recording['id']}/waveform")
    assert waveform.status_code == 200
    assert waveform.json()["duration_seconds"] == 2.5

    patch = client.patch(
        f"/api/recordings/{recording['id']}",
        json={
            "title": "Renamed recording",
            "notes": "New note",
            "recorded_at": "2023-01-01T05:00:00Z",
        },
    )
    assert patch.status_code == 200
    assert patch.json()["title"] == "Renamed recording"
    assert patch.json()["recorded_at"].startswith("2023-01-01T05:00:00")

    place_detail = client.get(f"/api/places/{place['id']}").json()
    assert place_detail["recording_count"] == 1
    assert place_detail["recordings"][0]["title"] == "Renamed recording"

    delete = client.delete(f"/api/recordings/{recording['id']}")
    assert delete.status_code == 200
    assert client.get(f"/api/recordings/{recording['id']}").status_code == 404


def test_upload_rejects_bad_inputs(client, tmp_path: Path) -> None:
    place = create_place(client)
    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not audio")
    with bad.open("rb") as handle:
        response = client.post(
            f"/api/places/{place['id']}/recordings",
            files={"file": ("bad.wav", handle, "audio/wav")},
        )
    assert response.status_code == 422
    assert "opened as audio" in response.json()["detail"]

    text = tmp_path / "recording.txt"
    text.write_text("hello")
    with text.open("rb") as handle:
        response = client.post(
            f"/api/places/{place['id']}/recordings",
            files={"file": ("recording.txt", handle, "text/plain")},
        )
    assert response.status_code == 415
    assert "Unsupported file extension" in response.json()["detail"]

    empty = tmp_path / "empty.wav"
    empty.write_bytes(b"")
    with empty.open("rb") as handle:
        response = client.post(
            f"/api/places/{place['id']}/recordings",
            files={"file": ("empty.wav", handle, "audio/wav")},
        )
    assert response.status_code == 422


def test_upload_enforces_file_size(tmp_path: Path) -> None:
    limited = Settings(
        data_dir=tmp_path / "data",
        model_dir=tmp_path / "models",
        database_path=tmp_path / "data" / "db.sqlite3",
        max_upload_mb=1,
    )
    app = create_app(limited)
    with TestClient(app) as local_client:
        place = local_client.post("/api/places", json={"name": "Size test"}).json()
        payload = io.BytesIO(b"\x00" * (1_200_000))
        response = local_client.post(
            f"/api/places/{place['id']}/recordings",
            files={"file": ("large.wav", payload, "audio/wav")},
        )
        assert response.status_code == 413
        assert "upload limit" in response.json()["detail"]


def test_upload_rejects_invalid_source_and_place(client, tmp_path: Path) -> None:
    place = create_place(client)
    path = make_audio(tmp_path / "ok.wav")
    with path.open("rb") as handle:
        response = client.post(
            f"/api/places/{place['id']}/recordings",
            files={"file": ("ok.wav", handle, "audio/wav")},
            data={"source": "other"},
        )
    assert response.status_code == 422
    with path.open("rb") as handle:
        response = client.post(
            "/api/places/999/recordings",
            files={"file": ("ok.wav", handle, "audio/wav")},
        )
    assert response.status_code == 404


def test_analysis_requires_installed_model(client, tmp_path: Path) -> None:
    place = create_place(client)
    recording = upload(client, place["id"], tmp_path)
    response = client.post(f"/api/recordings/{recording['id']}/analyze", json={})
    assert response.status_code == 503
    assert "Sound reader not installed" in response.json()["detail"]
    status = client.get(f"/api/recordings/{recording['id']}/analysis")
    assert status.status_code == 200
    assert status.json()["status"] == "not_analyzed"
    assert status.json()["analysis"] is None


def test_analysis_endpoint_404(client) -> None:
    assert client.get("/api/recordings/999/analysis").status_code == 404
    assert client.post("/api/recordings/999/analyze", json={}).status_code == 404
    assert client.get("/api/recordings/999/audio").status_code == 404


def test_audio_path_traversal_is_blocked(client, settings, tmp_path: Path) -> None:
    place = create_place(client)
    recording = upload(client, place["id"], tmp_path)
    with connect(settings) as connection:
        connection.execute(
            "UPDATE recordings SET internal_audio_path = '../outside.wav' WHERE id = ?",
            (recording["id"],),
        )
        connection.commit()
    response = client.get(f"/api/recordings/{recording['id']}/audio")
    assert response.status_code == 403
    assert "escapes" in response.json()["detail"] or "outside" in response.json()["detail"]


def test_comparison_validation_and_missing_records(client) -> None:
    assert client.post("/api/comparisons", json={}).status_code == 422
    response = client.post(
        "/api/comparisons",
        json={"place_id": 999, "baseline_recording_ids": [1], "recent_recording_ids": [2]},
    )
    assert response.status_code == 404
    assert client.get("/api/comparisons/999").status_code == 404
    place = create_place(client)
    response = client.post(
        "/api/comparisons",
        json={
            "place_id": place["id"],
            "baseline_recording_ids": [999],
            "recent_recording_ids": [998],
        },
    )
    assert response.status_code == 422
    assert "does not exist" in response.json()["detail"]


def test_comparison_rejects_unanalyzed_recording(client, tmp_path: Path) -> None:
    place = create_place(client)
    first = upload(client, place["id"], tmp_path, "one.wav")
    second = upload(client, place["id"], tmp_path, "two.wav")
    response = client.post(
        "/api/comparisons",
        json={
            "place_id": place["id"],
            "baseline_recording_ids": [first["id"]],
            "recent_recording_ids": [second["id"]],
        },
    )
    assert response.status_code == 422
    assert "not finished finding sounds" in response.json()["detail"]


def test_overview_and_model_status(client) -> None:
    place = create_place(client)
    overview = client.get("/api/overview").json()
    assert overview["place_count"] == 1
    assert overview["recording_count"] == 0
    assert overview["latest_recording"] is None
    assert overview["notable_changes"] == []
    models = client.get("/api/models/status")
    assert models.status_code == 200
    data = models.json()
    assert data["audio"]["status"] == "not_installed"
    assert data["offline_ready"] is False
    assert "gemma" in data
    gemma = client.get("/api/models/gemma")
    assert gemma.status_code == 200
    assert "reachable" in gemma.json()


def test_demo_initially_absent(client) -> None:
    response = client.get("/api/demo")
    assert response.status_code == 200
    assert response.json()["status"] == "absent"
    demo_prepare = client.post("/api/demo/prepare")
    assert demo_prepare.status_code == 503


def test_demo_cannot_be_prepared_without_model(client) -> None:
    response = client.post("/api/demo/prepare")
    assert response.status_code == 503
    assert "Sound reader not installed" in response.json()["detail"]
