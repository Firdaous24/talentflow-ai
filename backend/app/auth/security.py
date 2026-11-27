"""Password hashing, random tokens, CSRF tokens and pseudonymous references.

- argon2id with the OWASP baseline (m = 19 MiB, t = 2, p = 1); hashes made with
  older parameters are re-hashed transparently at the next successful login.
- Session and e-mail tokens are 256-bit random values; only their SHA-256 is stored.
- CSRF uses a signed double-submit token bound to the current session (or to the
  anonymous state), so a login changes the token and an attacker without the
  server secret cannot forge one.
"""

import base64
import hashlib
import hmac
import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

ARGON2_MEMORY_KIB = 19 * 1024
ARGON2_TIME_COST = 2
ARGON2_PARALLELISM = 1
TOKEN_BYTES = 32

_hasher = PasswordHasher(time_cost=ARGON2_TIME_COST, memory_cost=ARGON2_MEMORY_KIB, parallelism=ARGON2_PARALLELISM, type=Type.ID)
# Verified against when an account does not exist, so both paths cost one argon2 verification.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> tuple[bool, bool]:
    """Return (valid, needs_rehash). A missing hash still costs a full verification."""
    try:
        _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, False
    if password_hash is None:
        return False, False
    return True, _hasher.check_needs_rehash(password_hash)


def new_token() -> tuple[str, bytes]:
    """A URL-safe random token for the client and the digest to store."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hash_token(token)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def csrf_token(secret: bytes, csrf_seed: str, session_token: str | None) -> str:
    binding = hash_token(session_token).hex() if session_token else "anonymous"
    return _b64(hmac.new(secret, f"csrf|{csrf_seed}|{binding}".encode(), hashlib.sha256).digest())


def csrf_valid(secret: bytes, csrf_seed: str | None, session_token: str | None, presented: str | None) -> bool:
    if not csrf_seed or not presented:
        return False
    return hmac.compare_digest(csrf_token(secret, csrf_seed, session_token), presented)


def pseudonym(secret: bytes, value: object) -> str:
    """Stable keyed reference for the audit log: not reversible without the server secret."""
    return hmac.new(secret, f"actor|{value}".encode(), hashlib.sha256).hexdigest()
