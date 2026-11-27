"""Encrypted CV versions: the only code that seals or opens stored CV content.

Each column is sealed with the version's own data key and a context naming the
version and the column. Plain CV content exists only in memory, for the owner's
request; it is never logged.
"""

import uuid

from sqlalchemy.orm import Session

from app.db.models import CandidateProfile as ProfileRow
from app.db.models import CVDataKey, CVVersion, uuid7
from app.models.candidate import CandidateProfile, CVParsingResponse
from app.storage import files
from app.storage.crypto import new_data_key, open_sealed, seal, unwrap_key, wrap_key


def _context(version_id: uuid.UUID, column: str) -> str:
    return f"cv_version|{version_id}|{column}"


def data_key(master: bytes, version: CVVersion) -> bytes:
    return unwrap_key(master, version.data_key.wrapped_key, str(version.id))


def create_version(db: Session, master: bytes, profile: ProfileRow, number: int, text: str, parsed: CVParsingResponse, original: bytes | None) -> CVVersion:
    version_id = uuid7()
    key = new_data_key()
    version = CVVersion(
        id=version_id, candidate_profile_id=profile.id, number=number, page_count=parsed.parsing_metadata.page_count,
        extracted_text_enc=seal(key, text.encode("utf-8"), _context(version_id, "extracted_text")),
        parsed_enc=seal(key, parsed.model_dump_json().encode("utf-8"), _context(version_id, "parsed")),
    )
    version.data_key = CVDataKey(cv_version_id=version_id, wrapped_key=wrap_key(master, key, str(version_id)))
    if original is not None:
        version.original_file_ref = files.write_encrypted(version_id, seal(key, original, _context(version_id, "original")))
    db.add(version)
    return version


def read_text(master: bytes, version: CVVersion) -> str:
    return open_sealed(data_key(master, version), version.extracted_text_enc, _context(version.id, "extracted_text")).decode("utf-8")


def read_parsed(master: bytes, version: CVVersion) -> CVParsingResponse:
    raw = open_sealed(data_key(master, version), version.parsed_enc, _context(version.id, "parsed"))
    return CVParsingResponse.model_validate_json(raw)


def read_reviewed(master: bytes, version: CVVersion) -> CandidateProfile | None:
    if version.reviewed_enc is None:
        return None
    raw = open_sealed(data_key(master, version), version.reviewed_enc, _context(version.id, "reviewed"))
    return CandidateProfile.model_validate_json(raw)


def write_reviewed(master: bytes, version: CVVersion, profile: CandidateProfile) -> None:
    version.reviewed_enc = seal(data_key(master, version), profile.model_dump_json().encode("utf-8"), _context(version.id, "reviewed"))


def read_original(master: bytes, version: CVVersion) -> bytes | None:
    if version.original_file_ref is None:
        return None
    return open_sealed(data_key(master, version), files.read_encrypted(version.original_file_ref), _context(version.id, "original"))


def current_profile(master: bytes, version: CVVersion) -> CandidateProfile:
    """The reviewed profile when there is one, otherwise the original extraction."""
    return read_reviewed(master, version) or read_parsed(master, version).candidate
