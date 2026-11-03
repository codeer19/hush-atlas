"""Clearly labelled, fully local sample archive.

The four demo recordings are synthesized in software (no third-party audio) and
then run through the *real* YAMNet pipeline. Their detections are genuine model
outputs for synthetic signals, not environmental evidence. The demo lives in a
separate place flagged is_demo and never appears in the user's archive counts.
The sample Soundwalk links those recordings to an ordered route and a completed
session so the map, report and repeat-visit views can be explored immediately.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
from scipy.signal import butter, sosfilt

from .analysis import perform_analysis
from .audio import write_wav
from .comparison import create_comparison, get_comparison
from .config import Settings
from .db import delete_setting, get_setting, set_setting
from .repository import create_place, delete_place, get_place, store_uploaded_file
from .walks import (
    attach_recording,
    create_walk,
    get_walk,
    update_walk,
    update_walk_stop,
    walk_map,
)
from .yamnet_service import YamnetEngine


logger = logging.getLogger(__name__)

DEMO_STATUS_KEY = "demo_status"
DEMO_PLACE_KEY = "demo_place_id"
DEMO_COMPARISON_KEY = "demo_comparison_id"
DEMO_WALK_KEY = "demo_walk_id"
DEMO_ERROR_KEY = "demo_error"
DEMO_SAMPLE_RATE = 32_000
DEMO_DURATION_SECONDS = 30.0
DEMO_THRESHOLD = 0.20

DEMO_STOPS = [
    ("Dawn corner", "Synthetic bird-like chirps and light rain."),
    ("Courtyard wall", "Synthetic chirps and filtered wind."),
    ("Street edge", "Synthetic low-frequency traffic rumble."),
    ("Rain barrel", "Synthetic traffic swell with light rain noise."),
]


@dataclass(frozen=True)
class DemoSpec:
    key: str
    title: str
    recorded_at: datetime
    original_filename: str
    notes: str


DEMO_SPECS = [
    DemoSpec(
        key="birds_rain",
        title="Dawn after rain — sample",
        recorded_at=datetime(2024, 5, 18, 6, 10, tzinfo=timezone.utc),
        original_filename="synthetic-dawn-birds-rain.wav",
        notes=(
            "Illustrative synthetic audio: birdsong-like chirps, wind and light rain generated "
            "in software. Not a field recording."
        ),
    ),
    DemoSpec(
        key="birds_wind",
        title="Wind through the courtyard — sample",
        recorded_at=datetime(2024, 6, 2, 5, 55, tzinfo=timezone.utc),
        original_filename="synthetic-morning-birds-wind.wav",
        notes=(
            "Illustrative synthetic audio: chirps and filtered wind generated in software. "
            "Not a field recording."
        ),
    ),
    DemoSpec(
        key="traffic_a",
        title="Evening traffic — sample",
        recorded_at=datetime(2026, 8, 14, 19, 20, tzinfo=timezone.utc),
        original_filename="synthetic-evening-traffic.wav",
        notes=(
            "Illustrative synthetic audio: low-frequency road rumble and passing-car swells "
            "generated in software. Not a field recording."
        ),
    ),
    DemoSpec(
        key="traffic_b",
        title="Road and rain — sample",
        recorded_at=datetime(2026, 9, 1, 18, 5, tzinfo=timezone.utc),
        original_filename="synthetic-road-rain.wav",
        notes=(
            "Illustrative synthetic audio: traffic-like rumble with light rain noise generated "
            "in software. Not a field recording."
        ),
    ),
]


def _envelope(size: int, attack: float = 0.01, release: float = 0.08) -> np.ndarray:
    envelope = np.ones(size, dtype=np.float32)
    attack_samples = min(int(attack * DEMO_SAMPLE_RATE), size // 2)
    release_samples = min(int(release * DEMO_SAMPLE_RATE), size // 2)
    if attack_samples > 0:
        envelope[:attack_samples] = np.linspace(0, 1, attack_samples, dtype=np.float32)
    if release_samples > 0:
        envelope[-release_samples:] = np.linspace(1, 0, release_samples, dtype=np.float32)
    return envelope


def _add_birds(audio: np.ndarray, strength: float, count: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    for _ in range(count):
        size = int(rng.uniform(0.06, 0.18) * DEMO_SAMPLE_RATE)
        freq_start = rng.uniform(1800, 3800)
        freq_end = freq_start * rng.uniform(0.7, 1.5)
        phase = 2 * np.pi * np.cumsum(np.linspace(freq_start, freq_end, size)) / DEMO_SAMPLE_RATE
        chirp = (np.sin(phase) + 0.25 * np.sin(2 * phase)) * _envelope(size)
        start = int(rng.uniform(0.2, DEMO_DURATION_SECONDS - 0.4) * DEMO_SAMPLE_RATE)
        audio[start : start + size] += (
            chirp.astype(np.float32) * strength * rng.uniform(0.15, 0.35)
        )


def _add_rain(audio: np.ndarray, level: float, seed: int) -> None:
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(len(audio)).astype(np.float32)
    rain = sosfilt(
        butter(4, [1000, 7000], btype="bandpass", fs=DEMO_SAMPLE_RATE, output="sos"), noise
    ).astype(np.float32)
    rain /= max(float(np.max(np.abs(rain))), 1e-6)
    drops = np.zeros(len(audio), dtype=np.float32)
    indexes = rng.integers(0, len(audio), size=400)
    drops[indexes] = rng.uniform(0.1, 0.6, size=400)
    drops = sosfilt(
        butter(2, [1500, 6000], btype="bandpass", fs=DEMO_SAMPLE_RATE, output="sos"), drops
    ).astype(np.float32)
    audio += level * rain + level * 0.6 * drops


def _add_traffic(audio: np.ndarray, level: float, seed: int, passes: int = 3) -> None:
    rng = np.random.default_rng(seed)
    time = np.arange(len(audio)) / DEMO_SAMPLE_RATE
    hum = (
        0.6 * np.sin(2 * np.pi * 55 * time)
        + 0.35 * np.sin(2 * np.pi * 110 * time)
        + 0.15 * np.sin(2 * np.pi * 220 * time)
    )
    amplitude = 0.6 + 0.4 * np.sin(2 * np.pi * 0.17 * time + 0.8)
    noise = rng.standard_normal(len(audio)).astype(np.float32)
    rumble = sosfilt(
        butter(3, 400, btype="lowpass", fs=DEMO_SAMPLE_RATE, output="sos"), noise
    ).astype(np.float32)
    rumble /= max(float(np.max(np.abs(rumble))), 1e-6)
    audio += level * (hum * amplitude + 0.9 * rumble).astype(np.float32)
    for _ in range(passes):
        center = rng.uniform(3, DEMO_DURATION_SECONDS - 3)
        width = rng.uniform(1.2, 2.5)
        swell = np.exp(-0.5 * ((time - center) / width) ** 2)
        audio += (
            0.08 * swell * (hum * 0.5 + rumble * 1.2)
        ).astype(np.float32)


def _base_wind(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(int(DEMO_DURATION_SECONDS * DEMO_SAMPLE_RATE)).astype(
        np.float32
    )
    wind = sosfilt(
        butter(3, [80, 1400], btype="bandpass", fs=DEMO_SAMPLE_RATE, output="sos"), noise
    ).astype(np.float32)
    wind /= max(float(np.max(np.abs(wind))), 1e-6)
    return 0.035 * wind


def synthesize_demo(key: str) -> np.ndarray:
    audio = _base_wind(7)
    if key == "birds_rain":
        _add_birds(audio, 1.0, 18, 11)
        _add_rain(audio, 0.035, 12)
    elif key == "birds_wind":
        _add_birds(audio, 0.9, 14, 21)
    elif key == "traffic_a":
        _add_traffic(audio, 0.28, 41)
    elif key == "traffic_b":
        _add_traffic(audio, 0.22, 42, 2)
        _add_rain(audio, 0.02, 43)
    else:
        raise ValueError(f"Unknown demo sound specification: {key}")
    peak = max(float(np.max(np.abs(audio))), 1e-6)
    if peak > 0.9:
        audio *= 0.9 / peak
    return audio.astype(np.float32)


def _state_write(settings: Settings, key: str, value: str | None) -> None:
    if value is None:
        delete_setting(settings, key)
    else:
        set_setting(settings, key, value)


def demo_status(settings: Settings) -> dict[str, Any]:
    status = get_setting(settings, DEMO_STATUS_KEY)
    place_id_raw = get_setting(settings, DEMO_PLACE_KEY)
    comparison_id_raw = get_setting(settings, DEMO_COMPARISON_KEY)
    walk_id_raw = get_setting(settings, DEMO_WALK_KEY)
    place_id = int(place_id_raw) if place_id_raw and place_id_raw.isdigit() else None
    comparison_id = (
        int(comparison_id_raw) if comparison_id_raw and comparison_id_raw.isdigit() else None
    )
    walk_id = int(walk_id_raw) if walk_id_raw and walk_id_raw.isdigit() else None
    place = get_place(settings, place_id) if place_id else None
    if walk_id is not None and not get_walk(settings, walk_id):
        _state_write(settings, DEMO_WALK_KEY, None)
        walk_id = None
    if status == "ready" and not place:
        _state_write(settings, DEMO_STATUS_KEY, None)
        _state_write(settings, DEMO_PLACE_KEY, None)
        _state_write(settings, DEMO_COMPARISON_KEY, None)
        _state_write(settings, DEMO_WALK_KEY, None)
        status = None
    if not status:
        return {
            "status": "absent",
            "detail": (
                "No sample has been made yet. The sample uses generated audio and real sound "
                "reading on this device."
            ),
            "place_id": None,
            "place_name": None,
            "comparison_id": None,
            "walk_id": None,
            "recordings": [],
        }
    if status == "failed":
        return {
            "status": "failed",
            "detail": get_setting(settings, DEMO_ERROR_KEY)
            or "The sample archive could not be prepared.",
            "place_id": None,
            "place_name": None,
            "comparison_id": None,
            "walk_id": None,
            "recordings": [],
        }
    if status == "preparing" or not place:
        return {
            "status": "preparing",
            "detail": "Making sample recordings and finding their sounds.",
            "place_id": place_id,
            "place_name": place["name"] if place else None,
            "comparison_id": None,
            "walk_id": None,
            "recordings": [],
        }
    recordings = []
    for recording in place["recordings"]:
        recordings.append(
            {
                "recording_id": recording["id"],
                "title": recording["title"],
                "recorded_at": recording["recorded_at"],
                "status": recording["analysis_status"],
            }
        )
    return {
        "status": "ready",
        "detail": (
            "Sample recordings made on this device, with real sound reading, "
            "linked to a completed sample walk. These results are not "
            "environmental evidence."
        ),
        "place_id": place["id"],
        "place_name": place["name"],
        "comparison_id": comparison_id,
        "walk_id": walk_id,
        "recordings": recordings,
    }


def prepare_demo(settings: Settings, engine: YamnetEngine) -> None:
    """Background job: synthesize, store, analyze and compare the sample archive."""
    logger.info("Preparing synthetic demo archive")
    place_id: int | None = None
    try:
        model_status = engine.status()
        if model_status["status"] != "ready":
            raise RuntimeError(model_status["detail"])
        # Remove a stale/incomplete demo archive before rebuilding.
        existing_raw = get_setting(settings, DEMO_PLACE_KEY)
        if existing_raw and existing_raw.isdigit():
            delete_place(settings, int(existing_raw))
            # delete_place clears demo_* settings, so restore the in-flight marker.
            set_setting(settings, DEMO_STATUS_KEY, "preparing")
        place = create_place(
            settings,
            name="The Sample Courtyard",
            description=(
                "ILLUSTRATIVE DEMO. Four synthesized soundscape recordings, analyzed by the real "
                "Sample recordings are made on this device and read with the same sound reader as "
        "your own recordings. The dates and "
                "place are invented for demonstration. This is not environmental evidence."
            ),
            is_demo=True,
        )
        place_id = place["id"]
        set_setting(settings, DEMO_PLACE_KEY, str(place_id))
        recording_ids: list[int] = []
        for spec in DEMO_SPECS:
            logger.info("Synthesizing demo sound %s", spec.key)
            audio = synthesize_demo(spec.key)
            temp_path = settings.logs_dir / f"demo-{uuid.uuid4().hex}.wav"
            write_wav(temp_path, audio, DEMO_SAMPLE_RATE)
            recording = store_uploaded_file(
                settings,
                place_id=place_id,
                title=spec.title,
                notes=spec.notes,
                recorded_at=spec.recorded_at,
                original_filename=spec.original_filename,
                temp_path=temp_path,
                source="upload",
            )
            recording_ids.append(recording["id"])
            perform_analysis(settings, engine, recording["id"], DEMO_THRESHOLD)
        comparison_id = create_comparison(
            settings,
            {
                "place_id": place_id,
                "baseline_recording_ids": recording_ids[:2],
                "recent_recording_ids": recording_ids[2:],
                "threshold": DEMO_THRESHOLD,
                "fading_threshold_pp": 10.0,
            },
        )
        # Verify once so a broken comparison is never advertised as ready.
        get_comparison(settings, comparison_id)
        set_setting(settings, DEMO_COMPARISON_KEY, str(comparison_id))
        logger.info("Creating sample Soundwalk for demo recordings")
        walk = create_walk(
            settings,
            {
                "mission_key": "five-sounds",
                "place_id": place_id,
                "title": "Sample Soundwalk — synthesized audio",
                "notes": (
                    "ILLUSTRATIVE DEMO. This completed walk links four synthesized clips "
                    "to an ordered route. It is not a field visit and its sound results are "
                    "not environmental evidence."
                ),
                "route_name": "Sample Courtyard loop",
                "route_description": (
                    "A four-stop demonstration route built from synthesized audio."
                ),
                "recording_duration_seconds": 30.0,
                "stops": [
                    {
                        "name": name,
                        "notes": (
                            f"{notes} Synthesized for the sample archive; not a field "
                            "observation."
                        ),
                    }
                    for name, notes in DEMO_STOPS
                ],
            },
        )
        walk_id = int(walk["id"])
        for stop, recording_id in zip(walk["stops"], recording_ids, strict=True):
            attach_recording(settings, walk_id, stop["id"], recording_id)
            update_walk_stop(
                settings,
                walk_id,
                stop["id"],
                status="analyzed",
                observation=(
                    "Illustrative demo note: synthesized audio only, not a field observation."
                ),
            )
            update_walk_stop(settings, walk_id, stop["id"], status="reviewed")
        completed = update_walk(settings, walk_id, status="completed")
        if not completed or completed["status"] != "completed":
            raise RuntimeError("The sample Soundwalk could not be completed.")
        sample_map = walk_map(settings, walk_id)
        if not sample_map or len(sample_map["stops"]) != len(DEMO_STOPS):
            raise RuntimeError("The sample Soundwalk map could not be verified.")
        set_setting(settings, DEMO_WALK_KEY, str(walk_id))
        set_setting(settings, DEMO_STATUS_KEY, "ready")
        delete_setting(settings, DEMO_ERROR_KEY)
        logger.info(
            "Demo archive ready (place=%s comparison=%s walk=%s)",
            place_id,
            comparison_id,
            walk_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Demo preparation failed")
        if place_id is not None:
            delete_place(settings, place_id)
        _state_write(settings, DEMO_PLACE_KEY, None)
        _state_write(settings, DEMO_COMPARISON_KEY, None)
        _state_write(settings, DEMO_WALK_KEY, None)
        _state_write(settings, DEMO_ERROR_KEY, str(exc)[:1500])
        _state_write(settings, DEMO_STATUS_KEY, "failed")


def interrupt_stale_demo(settings: Settings) -> None:
    if get_setting(settings, DEMO_STATUS_KEY) == "preparing":
        place_id_raw = get_setting(settings, DEMO_PLACE_KEY)
        if place_id_raw and place_id_raw.isdigit():
            delete_place(settings, int(place_id_raw))
        _state_write(settings, DEMO_PLACE_KEY, None)
        _state_write(settings, DEMO_COMPARISON_KEY, None)
        _state_write(settings, DEMO_WALK_KEY, None)
        _state_write(settings, DEMO_STATUS_KEY, "failed")
        _state_write(
            settings,
            DEMO_ERROR_KEY,
            "Making the sample stopped when the app closed. Make it again.",
        )


def remove_demo(settings: Settings) -> bool:
    place_id_raw = get_setting(settings, DEMO_PLACE_KEY)
    removed = False
    if place_id_raw and place_id_raw.isdigit():
        removed, _warnings = delete_place(settings, int(place_id_raw))
    _state_write(settings, DEMO_PLACE_KEY, None)
    _state_write(settings, DEMO_COMPARISON_KEY, None)
    _state_write(settings, DEMO_WALK_KEY, None)
    _state_write(settings, DEMO_STATUS_KEY, None)
    _state_write(settings, DEMO_ERROR_KEY, None)
    return removed
