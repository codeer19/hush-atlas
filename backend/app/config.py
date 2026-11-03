"""Application configuration for Hush Atlas.

The app is local-first: paths default inside the repository and the launch
scripts bind the API to loopback. A hosted deployment overrides the data and
model directories with a persistent disk. A loopback Ollama instance is a
development-only fallback for written reflections; the shipped reflection
interface uses browser-local WebLLM.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
VENDOR_ROOT = BACKEND_ROOT / "vendor" / "yamnet"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SILENCE_",
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Hush Atlas"
    version: str = "2.0.0"
    hosted: bool = False

    data_dir: Path = PROJECT_ROOT / "data"
    model_dir: Path = PROJECT_ROOT / "models"
    database_path: Path | None = None
    yamnet_weights_path: Path | None = None
    yamnet_class_map_path: Path = VENDOR_ROOT / "yamnet_class_map.csv"

    max_upload_mb: int = Field(default=80, ge=1, le=500)
    max_duration_seconds: float = Field(default=180.0, ge=5.0, le=900.0)
    min_duration_seconds: float = Field(default=1.0, ge=0.5, le=10.0)
    max_sample_rate: int = Field(default=96_000, ge=8_000, le=192_000)
    max_channels: int = Field(default=8, ge=1, le=16)

    default_score_threshold: float = Field(default=0.20, ge=0.01, le=0.99)
    default_fading_threshold_pp: float = Field(default=10.0, ge=1.0, le=100.0)

    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = ""
    ollama_timeout_seconds: float = Field(default=120.0, ge=5.0, le=600.0)

    cors_origins: str = (
        "http://127.0.0.1:5173,http://localhost:5173,"
        "https://127.0.0.1:5173,https://localhost:5173,"
        "http://localhost:4173,https://localhost:4173"
    )
    analysis_workers: int = Field(default=1, ge=1, le=4)

    @field_validator("data_dir", "model_dir", "yamnet_weights_path", "database_path", mode="before")
    @classmethod
    def _expand_path(cls, value: object) -> object:
        if value is None or value == "":
            return None
        return Path(os.path.expandvars(str(value))).expanduser()

    @property
    def audio_dir(self) -> Path:
        return self.data_dir / "audio"

    @property
    def analysis_dir(self) -> Path:
        return self.data_dir / "analysis"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def db_path(self) -> Path:
        return self.database_path or (self.data_dir / "silence_archive.sqlite3")

    @property
    def weights_path(self) -> Path:
        return self.yamnet_weights_path or (self.model_dir / "yamnet" / "yamnet.h5")

    @property
    def class_map_path(self) -> Path:
        return self.yamnet_class_map_path

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def frontend_dist(self) -> Path:
        return PROJECT_ROOT / "frontend" / "dist"

    @property
    def ollama_is_loopback(self) -> bool:
        try:
            host = (urlparse(self.ollama_url).hostname or "").lower()
        except ValueError:
            return False
        return host in {"127.0.0.1", "localhost", "::1"}

    def ensure_directories(self) -> None:
        for directory in (
            self.data_dir,
            self.audio_dir,
            self.analysis_dir,
            self.logs_dir,
            self.weights_path.parent,
        ):
            directory.mkdir(parents=True, exist_ok=True)


settings = Settings()
