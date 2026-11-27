"""Lazy engine and per-request SQLAlchemy sessions (synchronous, run in FastAPI's threadpool)."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache(maxsize=4)
def engine_for(url: URL) -> Engine:
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def get_engine() -> Engine:
    return engine_for(get_settings().database_url)


def get_db() -> Iterator[Session]:
    """One session per request. Routes commit explicitly before answering, so a
    response is never sent for a write that has not been committed; anything
    left uncommitted (errors included) is rolled back when the session closes."""
    factory = sessionmaker(bind=get_engine(), expire_on_commit=False)
    with factory() as session:
        yield session
