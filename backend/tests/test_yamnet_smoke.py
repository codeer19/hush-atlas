from __future__ import annotations

import numpy as np
import pytest

from app.audio import write_wav
from app.config import Settings
from app.db import connect, portable_relative_path, utc_now_iso
from app.analysis import save_score_matrix
from app.yamnet_service import YamnetEngine


@pytest.mark.model
def test_real_yamnet_loads_521_classes_and_scores_known_signal(tmp_path) -> None:
    """Requires the official weights in models/yamnet/yamnet.h5.

    This is a real inference test, not a mock. It is skipped when weights are
    absent so a fresh clone can still run the rest of the suite.
    """
    settings = Settings()
    if not settings.weights_path.is_file():
        pytest.skip("YAMNet weights are not installed")
    engine = YamnetEngine(settings)
    status = engine.status()
    assert status["status"] == "ready"
    assert status["class_count"] == 521

    sample_rate = 16_000
    seconds = 3.0
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    waveform = (0.5 * np.sin(2 * np.pi * 440 * time)).astype(np.float32)
    path = tmp_path / "sine.wav"
    write_wav(path, waveform, sample_rate)

    from app.audio import decode_mono

    decoded, source_rate = decode_mono(path)
    assert source_rate == sample_rate
    prediction = engine.predict(decoded)
    assert prediction.scores.shape[1] == 521
    assert prediction.scores.shape[0] > 0
    assert np.isfinite(prediction.scores).all()
    assert prediction.scores.min() >= 0.0
    assert prediction.scores.max() <= 1.0
    assert len(prediction.labels) == 521
    top = np.argsort(prediction.scores.mean(axis=0))[-10:][::-1]
    top_labels = [prediction.labels[index] for index in top]
    assert "Sine wave" in top_labels, top_labels


@pytest.mark.model
def test_real_yamnet_window_timing_matches_documented_hop(tmp_path) -> None:
    settings = Settings()
    if not settings.weights_path.is_file():
        pytest.skip("YAMNet weights are not installed")
    engine = YamnetEngine(settings)
    waveform = np.zeros(16_000 * 2, dtype=np.float32)
    prediction = engine.predict(waveform)
    assert prediction.window_hop_seconds == pytest.approx(0.48)
    assert prediction.window_seconds == pytest.approx(0.96)
    # 2 seconds of audio with rounding up to complete patches.
    assert 3 <= prediction.scores.shape[0] <= 5
