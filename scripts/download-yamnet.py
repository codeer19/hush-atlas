#!/usr/bin/env python3
"""Download and verify the official YAMNet weights.

The file is served by Google's AudioSet storage. It is not redistributed in
this repository. The download is written to a temporary file and moved into
place only after its SHA-256 matches the known official artifact.

Usage:
    python scripts/download-yamnet.py
    python scripts/download-yamnet.py --force
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_URL = "https://storage.googleapis.com/audioset/yamnet.h5"
EXPECTED_SHA256 = "13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744"
EXPECTED_SIZE = 15_296_092


def default_destination() -> Path:
    model_dir = os.environ.get("SILENCE_MODEL_DIR", "").strip()
    root = Path(os.path.expandvars(model_dir)).expanduser() if model_dir else PROJECT_ROOT / "models"
    return root / "yamnet" / "yamnet.h5"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        WEIGHTS_URL,
        headers={"User-Agent": "Hush-Atlas-model-installer/1.0"},
    )

    last_error: Exception | None = None
    for attempt in range(1, 4):
        temporary: Path | None = None
        try:
            print(f"Downloading YAMNet weights (attempt {attempt}/3)…")
            with urllib.request.urlopen(request, timeout=120) as response:
                with tempfile.NamedTemporaryFile(
                    delete=False,
                    dir=destination.parent,
                    prefix="yamnet.",
                    suffix=".download",
                ) as handle:
                    temporary = Path(handle.name)
                    shutil.copyfileobj(response, handle)

            size = temporary.stat().st_size
            if size != EXPECTED_SIZE:
                raise RuntimeError(
                    f"Downloaded {size} bytes; expected {EXPECTED_SIZE} bytes."
                )
            actual = sha256(temporary)
            if actual != EXPECTED_SHA256:
                raise RuntimeError(
                    "The downloaded file did not match the official SHA-256. "
                    f"Got {actual}."
                )
            temporary.replace(destination)
            print(f"Verified YAMNet weights at {destination}")
            return
        except (urllib.error.URLError, TimeoutError, RuntimeError, OSError) as error:
            last_error = error
            if temporary and temporary.exists():
                temporary.unlink(missing_ok=True)
            if attempt < 3:
                time.sleep(attempt * 2)

    raise SystemExit(f"Could not download YAMNet weights: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Download again even when a verified file already exists.",
    )
    parser.add_argument(
        "--destination",
        type=Path,
        default=default_destination(),
        help="Destination file (default: models/yamnet/yamnet.h5).",
    )
    args = parser.parse_args()
    destination: Path = args.destination.expanduser().resolve()

    if destination.is_file() and not args.force:
        size = destination.stat().st_size
        if size == EXPECTED_SIZE and sha256(destination) == EXPECTED_SHA256:
            print(f"YAMNet weights are already verified at {destination}")
            return 0
        print(f"Existing file at {destination} is not the verified artifact; replacing it.")

    download(destination)
    return 0


if __name__ == "__main__":
    sys.exit(main())
