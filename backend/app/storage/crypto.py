"""Envelope encryption for stored CV content (design §2.5 and §5.5, decision A3).

- The master key comes only from the environment (TALENTFLOW_DATA_KEY, 32 random
  bytes in base64url). It never reaches the database.
- Each CV version gets its own random 256-bit data key. The data key is stored
  wrapped (AES-256-GCM under the master key) in its own table row, apart from
  the ciphertext it protects.
- Every value is sealed with AES-256-GCM and associated data naming its row and
  column, so a ciphertext copied to another row or column fails to open.
- Deleting the wrapped data key makes every copy of the ciphertext unreadable,
  including copies in backups and leftover files (crypto-shredding).

Blob layout: version byte (1) | nonce (12) | ciphertext and tag.
"""

import base64
import binascii
import os
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DATA_KEY_ENV = "TALENTFLOW_DATA_KEY"
KEY_BYTES = 32
NONCE_BYTES = 12
FORMAT_VERSION = b"\x01"
PLACEHOLDER_PREFIX = "change-me"


class EncryptionNotConfigured(RuntimeError):
    """TALENTFLOW_DATA_KEY is missing, a placeholder, or not 32 bytes of base64url."""


class DecryptionFailed(RuntimeError):
    """The blob was altered, moved to another row or column, or its key is gone."""


def parse_master_key(value: str) -> bytes:
    value = value.strip()
    if not value or value.lower().startswith(PLACEHOLDER_PREFIX):
        raise EncryptionNotConfigured(f"Generate {DATA_KEY_ENV} (32 random bytes, base64url).")
    try:
        key = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as error:
        raise EncryptionNotConfigured(f"{DATA_KEY_ENV} must be base64url.") from error
    if len(key) != KEY_BYTES:
        raise EncryptionNotConfigured(f"{DATA_KEY_ENV} must decode to exactly {KEY_BYTES} bytes.")
    return key


@lru_cache(maxsize=1)
def master_key() -> bytes:
    return parse_master_key(os.environ.get(DATA_KEY_ENV, ""))


def new_data_key() -> bytes:
    return AESGCM.generate_key(bit_length=KEY_BYTES * 8)


def seal(key: bytes, plaintext: bytes, context: str) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return FORMAT_VERSION + nonce + AESGCM(key).encrypt(nonce, plaintext, context.encode("utf-8"))


def open_sealed(key: bytes, blob: bytes, context: str) -> bytes:
    if len(blob) < 1 + NONCE_BYTES + 16 or blob[:1] != FORMAT_VERSION:
        raise DecryptionFailed("Unknown ciphertext format.")
    try:
        return AESGCM(key).decrypt(blob[1:1 + NONCE_BYTES], blob[1 + NONCE_BYTES:], context.encode("utf-8"))
    except InvalidTag as error:
        raise DecryptionFailed("The ciphertext does not match its key or context.") from error


def wrap_key(master: bytes, data_key: bytes, owner: str) -> bytes:
    return seal(master, data_key, f"data-key|{owner}")


def unwrap_key(master: bytes, wrapped: bytes, owner: str) -> bytes:
    return open_sealed(master, wrapped, f"data-key|{owner}")
