"""Async SQLAlchemy engine/session — source of truth for document and
conversation metadata (Qdrant only stores vectors+payloads, Redis is a
volatile cache, neither is a durable list of "what documents exist")."""
import logging

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _safe_url() -> str:
    """DATABASE_URL with the password removed.

    Connection strings reach logs on every boot, and log aggregators are far
    less protected than .env files — so the credential must never be in the
    string we hand to the logger.
    """
    try:
        return make_url(settings.DATABASE_URL).render_as_string(hide_password=True)
    except Exception:
        return "<unparseable database url>"


def _engine_kwargs() -> dict:
    """Postgres behind Supabase's connection pooler needs settings SQLite does
    not, and passing them to SQLite raises."""
    if not settings.DATABASE_URL.startswith("postgresql"):
        return {}
    return {
        "connect_args": {"statement_cache_size": 0},
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_size": 15,
        "max_overflow": 10,
        "pool_timeout": 10,
    }


engine = create_async_engine(settings.DATABASE_URL, echo=False, **_engine_kwargs())
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)



# Columns added to tables that already exist in deployed databases.
#
# `create_all` creates missing *tables* and nothing else — it will not add a
# column to a table it already sees, and there is no Alembic here. So a new
# column ships as a row in this list too, or every existing install starts
# raising "no such column" on the first query that selects it.
#
# Each entry is (table, column, DDL type with default). Applied only when the
# column is genuinely absent, so a restart is a no-op and the list can stay in
# place indefinitely. Types are spelled to be valid in both SQLite and
# Postgres, which is the only dialect pair this app runs on.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    # DEFAULT true, not 1 — Postgres rejects an integer default on a boolean
    # column, and SQLite has accepted the TRUE keyword since 3.23. The default
    # is what gives existing agents the rules rather than a null.
    ("agents", "style_rules_enabled", "BOOLEAN NOT NULL DEFAULT true"),
]


def _apply_added_columns(connection) -> None:
    """Add any column in `_ADDED_COLUMNS` the live schema is missing.

    Sync (run via `run_sync`) because SQLAlchemy's inspector has no async form.
    A failure on one column is logged and skipped rather than raised: a boot
    that cannot add an optional column should still serve every request that
    does not need it, instead of taking the whole API down.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())

    for table, column, ddl_type in _ADDED_COLUMNS:
        if table not in existing_tables:
            continue  # create_all just made it, with the column already on it.
        columns = {c["name"] for c in inspector.get_columns(table)}
        if column in columns:
            continue
        try:
            connection.execute(
                text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")
            )
            logger.info("Added missing column %s.%s", table, column)
        except Exception:
            logger.exception("Could not add column %s.%s", table, column)


async def init_db():
    # Import models so their tables are registered on Base.metadata before create_all.
    from app.models import db_models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_apply_added_columns)
    logger.info("Database ready (%s)", _safe_url())
