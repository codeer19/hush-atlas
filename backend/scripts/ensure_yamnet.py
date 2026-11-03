"""Fetch and verify the official YAMNet weights for a server deployment.

Render's filesystem is replaced on every deploy unless a persistent disk is
mounted. This script keeps the ~15 MB weights on that disk, verifies the
official SHA-256, and exits without failing the deploy when the download is
temporarily unreachable. A checksum mismatch is fatal: a wrong file must not be
served as the sound reader.

Usage (from the backend directory, or through the Render start command):
    python scripts/ensure_yamnet.py
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings  # noqa: E402

WEIGHTS_URL = "https://storage.googleapis.com/audioset/yamnet.h5"
EXPECTED_SHA256 = "13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744"
CHUNK_BYTES = 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    target = settings.weights_path
    if target.is_file():
        current = sha256(target)
        if current == EXPECTED_SHA256:
            print(f"YAMNet weights already present and verified: {target}")
            return 0
        print(
            f"Existing weights fail checksum verification ({current}); "
            "downloading a verified copy."
        )

    settings.ensure_directories()
    temporary = target.with_name(target.name + ".download")

    print(f"Downloading YAMNet weights from {WEIGHTS_URL}")
    try:
        with urllib.request.urlopen(WEIGHTS_URL, timeout=120) as response:
            with temporary.open("wb") as handle:
                while True:
                    block = response.read(CHUNK_BYTES)
                    if not block:
                        break
                    handle.write(block)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        temporary.unlink(missing_ok=True)
        print(
            "Could not download the YAMNet weights: "
            f"{type(exc).__name__}: {exc}\n"
            "The API will still start, but sound analysis will report that the "
            "sound reader is not installed. Download again with "
            "`python scripts/ensure_yamnet.py`.",
            file=sys.stderr,
        )
        return 0

    downloaded = sha256(temporary)
    if downloaded != EXPECTED_SHA256:
        temporary.unlink(missing_ok=True)
        print(
            "The downloaded weights failed checksum verification. "
            f"Expected {EXPECTED_SHA256}, got {downloaded}.",
            file=sys.stderr,
        )
        return 1

    os.replace(temporary, target)
    print(f"YAMNet weights installed and verified: {target}")
    print(f"sha256 {downloaded}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
