"""Lazy, real YAMNet inference using the official TensorFlow model code.

The model definition, parameters, feature extraction and class map are vendored
unmodified from tensorflow/models/research/audioset/yamnet (Apache-2.0).
Weights are downloaded separately into an ignored local directory.
"""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import VENDOR_ROOT, Settings
from .audio import YAMNET_SAMPLE_RATE

# Must be set before TensorFlow / tf-keras are imported. YAMNet is Keras 2 code
# and is documented as incompatible with Keras 3.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

logger = logging.getLogger(__name__)

MODEL_NAME = "YAMNet (AudioSet)"
WINDOW_HOP_SECONDS = 0.48
WINDOW_SECONDS = 0.96


class ModelUnavailableError(RuntimeError):
    """YAMNet cannot be loaded, with a message a user can act on."""


@dataclass(frozen=True)
class YamnetPrediction:
    scores: np.ndarray
    labels: list[str]
    window_hop_seconds: float
    window_seconds: float
    model_version: str
    inference_seconds: float


def _sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class YamnetEngine:
    """One loaded model per process. Inference is serialized for predictable memory use."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None
        self._tf = None
        self._labels: list[str] | None = None
        self._load_error: str | None = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._weights_hash = _sha256(settings.weights_path)
        self._class_map_hash = _sha256(settings.class_map_path)

    @property
    def class_map_hash(self) -> str | None:
        return self._class_map_hash

    @property
    def model_version(self) -> str | None:
        if not self._weights_hash:
            return None
        return f"yamnet-audioset-2019-11-18-{self._weights_hash[:12]}"

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _dependency_report(self) -> tuple[bool, list[str]]:
        missing = [
            name
            for name in ("tensorflow", "tf_keras", "soundfile", "scipy")
            if importlib.util.find_spec(name) is None
        ]
        return (not missing, missing)

    def status(self) -> dict:
        deps_ok, missing = self._dependency_report()
        weights_present = self.settings.weights_path.is_file()
        class_map_present = self.settings.class_map_path.is_file()
        class_count = None
        if class_map_present:
            try:
                with self.settings.class_map_path.open("r", encoding="utf-8") as handle:
                    class_count = max(0, sum(1 for _ in handle) - 1)
            except OSError:
                class_map_present = False

        if self._load_error:
            state = "error"
            label = "Audio model failed to load"
            detail = self._load_error
        elif not deps_ok:
            state = "not_installed"
            label = "Audio model dependencies missing"
            detail = (
                "Missing Python packages: "
                + ", ".join(missing)
                + ". Run scripts\\setup.ps1 to install the pinned environment."
            )
        elif not weights_present:
            state = "not_installed"
            label = "Sound reader not installed"
            detail = (
                f"The sound reader is missing its model file ({self.settings.weights_path.name}). "
                "Run scripts\\download-models.ps1 locally, or python scripts/ensure_yamnet.py "
                "on a server (about 15 MB)."
            )
        elif not class_map_present or class_count != 521:
            state = "error"
            label = "Sound reader files incomplete"
            detail = (
                "The sound reader's list of sound names is missing or incomplete. "
                "Run setup again."
            )
        else:
            state = "ready"
            label = "Sound reader ready"
            detail = (
                "The sound reader is ready. It loads on this device the first time you use it."
            )

        return {
            "status": state,
            "label": label,
            "detail": detail,
            "weights_present": weights_present,
            "class_map_present": class_map_present,
            "dependencies_present": deps_ok,
            "loaded": self.loaded,
            "model_version": self.model_version,
            "class_count": class_count,
            "weights_sha256": self._weights_hash,
            "class_map_sha256": self._class_map_hash,
        }

    def _load(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            deps_ok, missing = self._dependency_report()
            if not deps_ok:
                raise ModelUnavailableError(
                    "The sound reader is missing some software ("
                    + ", ".join(missing)
                    + "). Run scripts\\setup.ps1, then try again."
                )
            if not self.settings.weights_path.is_file():
                raise ModelUnavailableError(
                    "The sound reader is not installed. Run scripts\\download-models.ps1 "
                    "locally or python scripts/ensure_yamnet.py on a server, then try again."
                )
            if not self.settings.class_map_path.is_file():
                raise ModelUnavailableError(
                    "The sound reader is missing its list of sound names. Run setup again."
                )
            try:
                import tensorflow as tf

                if str(VENDOR_ROOT) not in sys.path:
                    sys.path.insert(0, str(VENDOR_ROOT))
                import params as yamnet_params  # type: ignore
                import yamnet as yamnet_model  # type: ignore

                model = yamnet_model.yamnet_frames_model(yamnet_params.Params())
                model.load_weights(str(self.settings.weights_path))
                labels = [str(name) for name in yamnet_model.class_names(
                    str(self.settings.class_map_path)
                ).tolist()]
                if len(labels) != 521:
                    raise ModelUnavailableError(
                        f"The sound reader's sound list is incomplete; found {len(labels)} names instead of 521."
                    )
                self._tf = tf
                self._model = model
                self._labels = labels
                self._load_error = None
                logger.info("YAMNet loaded locally (%s)", self.model_version)
            except ModelUnavailableError:
                raise
            except Exception as exc:  # noqa: BLE001 - surfaced to the user with guidance
                self._load_error = (
                    "The sound reader could not start. Check the setup instructions and try "
                    "again. Original error: "
                    f"{type(exc).__name__}: {exc}"
                )
                logger.exception("YAMNet load failed")
                raise ModelUnavailableError(self._load_error) from exc

    def predict(self, waveform: np.ndarray) -> YamnetPrediction:
        if waveform.ndim != 1:
            raise ValueError("YAMNet expects a one-dimensional mono waveform.")
        if waveform.size < int(0.5 * YAMNET_SAMPLE_RATE):
            raise ValueError("The waveform is too short to analyze.")
        if not np.isfinite(waveform).all():
            raise ValueError("The waveform contains non-finite samples.")
        self._load()
        assert self._model is not None and self._tf is not None and self._labels is not None

        with self._inference_lock:
            started = time.perf_counter()
            try:
                tensor = self._tf.constant(np.ascontiguousarray(waveform, dtype=np.float32))
                predictions, _embeddings, _spectrogram = self._model(tensor, training=False)
                scores = np.asarray(predictions, dtype=np.float32)
            except Exception as exc:  # noqa: BLE001
                raise ModelUnavailableError(
                    "The sound reader could not finish this recording. "
                    f"{type(exc).__name__}: {exc}. The recording remains saved."
                ) from exc
            elapsed = time.perf_counter() - started

        if scores.ndim != 2 or scores.shape[1] != 521:
            raise ModelUnavailableError(
                "The sound reader returned an unexpected result. Try again."
            )
        if scores.shape[0] == 0:
            raise ModelUnavailableError(
                "The recording is too short for the sound reader."
            )
        if not np.isfinite(scores).all():
            raise ModelUnavailableError(
                "The sound reader returned an invalid result. Try again."
            )
        scores = np.clip(scores, 0.0, 1.0)
        return YamnetPrediction(
            scores=scores,
            labels=self._labels,
            window_hop_seconds=WINDOW_HOP_SECONDS,
            window_seconds=WINDOW_SECONDS,
            model_version=self.model_version or "unknown",
            inference_seconds=elapsed,
        )
