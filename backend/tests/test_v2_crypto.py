"""Envelope encryption of stored CV content (no database needed)."""

import base64
import os

import pytest

from app.storage import crypto
from app.storage.crypto import DecryptionFailed, EncryptionNotConfigured


def encoded(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def test_master_key_must_be_32_random_bytes_in_base64url():
    raw = os.urandom(32)
    assert crypto.parse_master_key(encoded(raw)) == raw
    assert crypto.parse_master_key(" " + encoded(raw) + "\n") == raw
    for bad in ["", "change-me-generate-a-key", encoded(os.urandom(16)), encoded(os.urandom(48)), "not base64 at all!"]:
        with pytest.raises(EncryptionNotConfigured):
            crypto.parse_master_key(bad)


def test_master_key_is_read_from_the_environment_only(monkeypatch):
    crypto.master_key.cache_clear()
    monkeypatch.delenv(crypto.DATA_KEY_ENV, raising=False)
    with pytest.raises(EncryptionNotConfigured):
        crypto.master_key()
    raw = os.urandom(32)
    monkeypatch.setenv(crypto.DATA_KEY_ENV, encoded(raw))
    crypto.master_key.cache_clear()
    assert crypto.master_key() == raw
    crypto.master_key.cache_clear()


def test_seal_round_trips_and_hides_the_plaintext():
    key = crypto.new_data_key()
    secret = "Compétences : Python, FastAPI — fictif".encode()
    blob = crypto.seal(key, secret, "cv_version|1|extracted_text")
    assert secret not in blob and b"Python" not in blob
    assert crypto.open_sealed(key, blob, "cv_version|1|extracted_text") == secret
    # A fresh nonce each time: the same plaintext never gives the same ciphertext.
    assert crypto.seal(key, secret, "cv_version|1|extracted_text") != blob


def test_ciphertext_is_bound_to_its_key_row_and_column():
    key = crypto.new_data_key()
    blob = crypto.seal(key, b"fictional", "cv_version|A|parsed")
    with pytest.raises(DecryptionFailed):
        crypto.open_sealed(crypto.new_data_key(), blob, "cv_version|A|parsed")
    with pytest.raises(DecryptionFailed):
        crypto.open_sealed(key, blob, "cv_version|B|parsed")
    with pytest.raises(DecryptionFailed):
        crypto.open_sealed(key, blob, "cv_version|A|reviewed")
    tampered = blob[:-1] + bytes([blob[-1] ^ 1])
    with pytest.raises(DecryptionFailed):
        crypto.open_sealed(key, tampered, "cv_version|A|parsed")
    with pytest.raises(DecryptionFailed):
        crypto.open_sealed(key, b"\x02" + blob[1:], "cv_version|A|parsed")


def test_wrapped_data_keys_open_only_with_the_master_key_and_their_owner():
    master, data_key = os.urandom(32), crypto.new_data_key()
    wrapped = crypto.wrap_key(master, data_key, "version-1")
    assert data_key not in wrapped
    assert crypto.unwrap_key(master, wrapped, "version-1") == data_key
    with pytest.raises(DecryptionFailed):
        crypto.unwrap_key(os.urandom(32), wrapped, "version-1")
    with pytest.raises(DecryptionFailed):
        crypto.unwrap_key(master, wrapped, "version-2")


def test_crypto_shredding_without_the_data_key_nothing_opens():
    """Once the wrapped data key row is deleted, a leftover ciphertext copy is unreadable."""
    master = os.urandom(32)
    data_key = crypto.new_data_key()
    blob = crypto.seal(data_key, b"fictional CV text", "cv_version|X|extracted_text")
    del data_key  # The only way back was the wrapped key, now gone.
    for _ in range(3):
        with pytest.raises(DecryptionFailed):
            crypto.open_sealed(crypto.new_data_key(), blob, "cv_version|X|extracted_text")
    with pytest.raises(DecryptionFailed):
        crypto.open_sealed(master, blob, "cv_version|X|extracted_text")
