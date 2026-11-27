"""Alembic migrations: reversible, in sync with the models, and the audit log stays append-only."""

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from conftest import V2_TABLES, alembic_config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db.models import Base


@pytest.fixture
def engine(migrated_database):
    engine = create_engine(migrated_database)
    yield engine
    engine.dispose()


def tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_upgrade_downgrade_upgrade_is_clean(engine, migrated_database):
    config = alembic_config()
    assert set(V2_TABLES) <= tables(engine)
    command.downgrade(config, "base")
    assert tables(engine) <= {"alembic_version"}
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM pg_proc WHERE proname = 'audit_log_append_only'")) == 0
    command.upgrade(config, "head")
    assert set(V2_TABLES) <= tables(engine)


def test_models_and_migrations_do_not_drift(engine):
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert compare_metadata(context, Base.metadata) == []


def test_audit_log_is_append_only_except_for_expired_entries(engine):
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE audit_log RESTART IDENTITY"))
        connection.execute(text("INSERT INTO audit_log (action, at) VALUES ('recent', now()), ('expired', now() - interval '13 months')"))
    for statement in ("UPDATE audit_log SET action = 'changed'", "DELETE FROM audit_log WHERE action = 'recent'"):
        with pytest.raises(DBAPIError, match="append-only"), engine.begin() as connection:
            connection.execute(text(statement))
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM audit_log WHERE action = 'expired'"))
        assert connection.scalars(text("SELECT action FROM audit_log")).all() == ["recent"]


def test_constraints_reject_unknown_roles_and_duplicate_active_consents(engine):
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users CASCADE"))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), 'x@example.com', 'h', 'superuser')"))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), 'Upper@Example.com', 'h', 'candidate')"))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        user = connection.scalar(text("INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), 'c@example.com', 'h', 'candidate') RETURNING id"))
        for _ in range(2):
            connection.execute(text("INSERT INTO consents (id, user_id, purpose, policy_version) VALUES (gen_random_uuid(), :user, 'marketing', 'v1')"), {"user": user})
