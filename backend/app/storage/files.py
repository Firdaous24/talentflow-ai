"""Optional storage of original CV PDFs, disabled by default (decision A3).

The instance must opt in with CV_ORIGINAL_STORAGE=enabled, and the candidate
must ask for it on each upload. Files hold AES-256-GCM ciphertext only, sealed
with the version's data key; their name is the version identifier, never the
uploaded file name. Deleting the data key makes a leftover file unreadable.
"""

import os
import uuid
from pathlib import Path

DEFAULT_DIRECTORY = "/data/cv_files"


class OriginalStorageUnavailable(RuntimeError):
    """CV_ORIGINAL_STORAGE is disabled, or set to an unknown value."""


def original_storage_enabled() -> bool:
    value = os.environ.get("CV_ORIGINAL_STORAGE", "disabled").strip().lower()
    if value in {"", "disabled", "false", "0", "off"}:
        return False
    if value in {"enabled", "true", "1", "on"}:
        return True
    raise OriginalStorageUnavailable("CV_ORIGINAL_STORAGE must be enabled or disabled.")


def files_directory() -> Path:
    return Path(os.environ.get("CV_FILES_DIR", DEFAULT_DIRECTORY))


def file_path(version_id: uuid.UUID) -> Path:
    return files_directory() / f"{version_id}.bin"


def write_encrypted(version_id: uuid.UUID, blob: bytes) -> str:
    directory = files_directory()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = file_path(version_id)
    temporary = target.with_suffix(".tmp")
    with open(temporary, "wb") as handle:
        handle.write(blob)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
    return target.name


def read_encrypted(reference: str) -> bytes:
    return (files_directory() / Path(reference).name).read_bytes()


def remove(reference: str) -> None:
    (files_directory() / Path(reference).name).unlink(missing_ok=True)
