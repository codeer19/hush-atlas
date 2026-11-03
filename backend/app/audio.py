"""Audio validation, decoding, downmixing and resampling.

YAMNet is trained on 16 kHz mono float waveforms. We deliberately do not
normalize loudness: absolute amplitude is useful evidence and the model's
documented preprocessing does not require normalization.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from .config import Settings


class AudioValidationError(ValueError):
    """A user-actionable problem with an audio file."""


SUPPORTED_EXTENSIONS = {".wav", ".flac", ".mp3", ".ogg"}
FORMAT_EXTENSIONS = {"WAV": ".wav", "FLAC": ".flac", "MP3": ".mp3", "OGG": ".ogg"}
FORMAT_LABELS = {
    "WAV": "WAV",
    "FLAC": "FLAC",
    "MP3": "MP3",
    "OGG": "Ogg Vorbis",
}
MIME_TYPES = {
    "WAV": "audio/wav",
    "FLAC": "audio/flac",
    "MP3": "audio/mpeg",
    "OGG": "audio/ogg",
}
YAMNET_SAMPLE_RATE = 16_000
TARGET_PEAKS = 1200


@dataclass(frozen=True)
class AudioInfo:
    duration_seconds: float
    sample_rate: int
    channels: int
    frames: int
    audio_format: str
    subtype: str
    peaks: list[float]


def supported_format_summary() -> list[str]:
    available = sf.available_formats()
    return [
        FORMAT_LABELS[format_name]
        for format_name in FORMAT_EXTENSIONS
        if format_name in available
    ]


def canonical_extension(audio_format: str) -> str:
    extension = FORMAT_EXTENSIONS.get(audio_format.upper())
    if not extension:
        raise AudioValidationError(
            f"The decoded format “{audio_format}” is not supported. Use WAV, FLAC, MP3, or Ogg Vorbis."
        )
    return extension


def audio_mime(audio_format: str) -> str:
    return MIME_TYPES.get(audio_format.upper(), "application/octet-stream")


def safe_display_filename(filename: str | None, fallback: str = "recording") -> str:
    """Keep a display-only filename, never a filesystem path."""
    if not filename:
        return fallback
    name = re.split(r"[\\/]", filename)[-1].strip()
    name = name.replace("\x00", "")[:255]
    return name or fallback


def validate_duration(duration: float, settings: Settings) -> None:
    if not math.isfinite(duration) or duration <= 0:
        raise AudioValidationError("This file contains no readable audio.")
    if duration < settings.min_duration_seconds:
        raise AudioValidationError(
            f"Record for at least {settings.min_duration_seconds:g} seconds."
        )
    if duration > settings.max_duration_seconds:
        raise AudioValidationError(
            f"This recording is {duration:.1f} seconds long. The first version accepts files "
            f"up to {settings.max_duration_seconds:.0f} seconds. Trim it and try again."
        )


def probe_audio(path: Path, settings: Settings, peaks_count: int = TARGET_PEAKS) -> AudioInfo:
    """Read metadata and a true amplitude envelope without loading the file whole."""
    try:
        info = sf.info(str(path))
    except (RuntimeError, sf.LibsndfileError) as exc:
        raise AudioValidationError(
            "This file could not be opened as audio. It may be damaged or in an "
            "unsupported codec. WAV, FLAC, MP3, and Ogg Vorbis are supported."
        ) from exc

    audio_format = (info.format or "").upper()
    if audio_format not in FORMAT_EXTENSIONS:
        raise AudioValidationError(
            f"The file is encoded as {info.format or 'an unknown format'}. Use WAV, FLAC, MP3, "
            "or Ogg Vorbis."
        )
    if info.channels < 1 or info.channels > settings.max_channels:
        raise AudioValidationError(
            f"This file has an unsupported number of audio channels (up to {settings.max_channels} allowed)."
        )
    if info.samplerate < 8_000 or info.samplerate > settings.max_sample_rate:
        raise AudioValidationError(
            f"This file's audio settings are outside the supported range (8,000 to {settings.max_sample_rate:,} Hz)."
        )
    if info.frames <= 0:
        raise AudioValidationError("This file contains no audio.")

    duration = info.frames / float(info.samplerate)
    validate_duration(duration, settings)

    peaks = np.zeros(peaks_count, dtype=np.float32)
    try:
        with sf.SoundFile(str(path)) as handle:
            cursor = 0
            while cursor < info.frames:
                block = handle.read(65_536, dtype="float32", always_2d=True)
                if block.size == 0:
                    break
                if not np.isfinite(block).all():
                    raise AudioValidationError(
                        "This file contains audio that cannot be read safely."
                    )
                block_peaks = np.max(np.abs(block), axis=1)
                indexes = np.minimum(
                    (np.arange(cursor, cursor + len(block_peaks)) * peaks_count) // info.frames,
                    peaks_count - 1,
                )
                np.maximum.at(peaks, indexes, block_peaks)
                cursor += len(block)
    except AudioValidationError:
        raise
    except (RuntimeError, sf.LibsndfileError) as exc:
        raise AudioValidationError(
            "This file's audio could not be read. It may be damaged."
        ) from exc

    if cursor == 0:
        raise AudioValidationError("This file contains no readable audio.")
    peaks = np.clip(peaks, 0.0, 1.0)
    return AudioInfo(
        duration_seconds=float(duration),
        sample_rate=int(info.samplerate),
        channels=int(info.channels),
        frames=int(info.frames),
        audio_format=audio_format,
        subtype=info.subtype or "unknown",
        peaks=[round(float(value), 5) for value in peaks],
    )


def decode_mono(path: Path, target_sample_rate: int = YAMNET_SAMPLE_RATE) -> tuple[np.ndarray, int]:
    """Decode to a mono float32 waveform at 16 kHz using polyphase resampling."""
    try:
        data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except (RuntimeError, sf.LibsndfileError) as exc:
        raise AudioValidationError(
            "The saved audio could not be opened. It may have been moved or damaged."
        ) from exc

    if data.size == 0 or len(data) == 0:
        raise AudioValidationError("The stored audio contains no samples.")
    if not np.isfinite(data).all():
        raise AudioValidationError("The audio contains invalid samples and cannot be analyzed.")

    mono = np.mean(data, axis=1, dtype=np.float32)
    if sample_rate != target_sample_rate:
        divisor = math.gcd(int(sample_rate), int(target_sample_rate))
        up = target_sample_rate // divisor
        down = int(sample_rate) // divisor
        mono = resample_poly(mono, up, down).astype(np.float32, copy=False)
    if mono.size == 0:
        raise AudioValidationError("Resampling produced an empty waveform.")
    return np.ascontiguousarray(mono, dtype=np.float32), int(sample_rate)


def write_wav(path: Path, samples: np.ndarray, sample_rate: int = YAMNET_SAMPLE_RATE) -> None:
    """Write PCM-16 WAV for generated demo material and tests."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.asarray(samples, dtype=np.float32)
    if data.ndim == 1:
        data = data[:, None]
    sf.write(str(path), np.clip(data, -1.0, 1.0), sample_rate, subtype="PCM_16", format="WAV")


def display_peak_summary(peaks: list[float]) -> float:
    return max(peaks) if peaks else 0.0
