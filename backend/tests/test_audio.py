from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from soundfile import LibsndfileError

from app.audio import (
    AudioValidationError,
    decode_mono,
    probe_audio,
    safe_display_filename,
    supported_format_summary,
)
from app.config import Settings
from tests.conftest import make_audio


def test_supported_formats_include_wav_flac_mp3(settings: Settings) -> None:
    labels = supported_format_summary()
    assert "WAV" in labels
    assert "FLAC" in labels
    assert "MP3" in labels


def test_probe_extracts_true_peaks_and_duration(settings: Settings, tmp_path: Path) -> None:
    path = make_audio(tmp_path / "tone.wav", seconds=2.5, amplitude=0.37)
    info = probe_audio(path, settings)
    assert info.duration_seconds == pytest.approx(2.5, abs=0.01)
    assert info.sample_rate == 32_000
    assert info.channels == 1
    assert info.audio_format == "WAV"
    assert len(info.peaks) == 1200
    assert max(info.peaks) > 0.2
    assert all(0.0 <= peak <= 1.0 for peak in info.peaks)


def test_probe_detects_no_audio(tmp_path: Path, settings: Settings) -> None:
    path = tmp_path / "empty.wav"
    path.write_bytes(b"")
    with pytest.raises(AudioValidationError):
        probe_audio(path, settings)


def test_rejects_duration_above_limit(tmp_path: Path) -> None:
    strict = Settings(
        data_dir=tmp_path / "data",
        model_dir=tmp_path / "models",
        max_duration_seconds=5,
    )
    strict.ensure_directories()
    path = make_audio(tmp_path / "long.wav", seconds=6)
    with pytest.raises(AudioValidationError, match="up to 5 seconds"):
        probe_audio(path, strict)


def test_rejects_too_short_audio(tmp_path: Path, settings: Settings) -> None:
    path = make_audio(tmp_path / "short.wav", seconds=0.5)
    with pytest.raises(AudioValidationError, match="at least"):
        probe_audio(path, settings)


def test_rejects_undecodable_data(tmp_path: Path, settings: Settings) -> None:
    path = tmp_path / "not-audio.wav"
    path.write_bytes(b"not really a wave file")
    with pytest.raises(AudioValidationError, match="opened as audio"):
        probe_audio(path, settings)


def test_stereo_downmix_and_resample_to_16k(tmp_path: Path, settings: Settings) -> None:
    # Left channel 0.4, right channel 0.0 => mean amplitude 0.2.
    sample_rate = 44_100
    seconds = 2.0
    samples = int(seconds * sample_rate)
    time = np.arange(samples) / sample_rate
    left = (0.4 * np.sin(2 * np.pi * 220 * time)).astype(np.float32)
    data = np.column_stack((left, np.zeros_like(left)))
    path = tmp_path / "stereo.wav"
    import soundfile as sf

    sf.write(str(path), data, sample_rate, subtype="PCM_16")
    decoded, source_rate = decode_mono(path)
    assert source_rate == sample_rate
    assert decoded.ndim == 1
    assert decoded.dtype == np.float32
    assert len(decoded) == pytest.approx(16_000 * seconds, abs=4)
    assert np.max(np.abs(decoded)) == pytest.approx(0.2, abs=0.02)


def test_decode_does_not_normalize(tmp_path: Path, settings: Settings) -> None:
    path = make_audio(tmp_path / "quiet.wav", amplitude=0.03)
    decoded, _ = decode_mono(path)
    assert np.max(np.abs(decoded)) < 0.05


def test_safe_display_filename_removes_paths() -> None:
    assert safe_display_filename(r"C:\Users\me\secret\garden.wav") == "garden.wav"
    assert safe_display_filename("../../etc/passwd") == "passwd"
    assert safe_display_filename("") == "recording"
