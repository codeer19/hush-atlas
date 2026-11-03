from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    app_settings = Settings(
        data_dir=tmp_path / "data",
        model_dir=tmp_path / "models",
        database_path=tmp_path / "data" / "archive.sqlite3",
    )
    app_settings.ensure_directories()
    init_db(app_settings)
    return app_settings


@pytest.fixture()
def client(settings: Settings):
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


def make_audio(
    path: Path,
    *,
    seconds: float = 2.0,
    sample_rate: int = 32_000,
    channels: int = 1,
    frequency: float = 440.0,
    amplitude: float = 0.2,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = int(seconds * sample_rate)
    time = np.arange(samples) / sample_rate
    waveform = (amplitude * np.sin(2 * np.pi * frequency * time)).astype(np.float32)
    if channels == 2:
        waveform = np.column_stack((waveform, waveform * 0.5))
    sf.write(str(path), waveform, sample_rate, subtype="PCM_16", format="WAV")
    return path
