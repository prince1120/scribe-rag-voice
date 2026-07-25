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
        # The pooler multiplexes server connections, so a prepared statement
        # created on one can vanish before it is reused — asyncpg then fails
        # with "prepared statement does not exist". Disabling the cache is the
        # supported way to run asyncpg through a pooler.
        "connect_args": {"statement_cache_size": 0},
        # The pooler silently drops idle connections; without this the first
        # query after an idle period fails instead of reconnecting.
        "pool_pre_ping": True,
        "pool_recycle": 300,
        # Supabase's free tier has a low connection ceiling, and this app runs
        # alongside a voice worker that opens its own.
        "pool_size": 5,
        "max_overflow": 5,
    }


engine = create_async_engine(settings.DATABASE_URL, echo=False, **_engine_kwargs())
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db():
    # Import models so their tables are registered on Base.metadata before create_all.
    from app.models import db_models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database ready (%s)", _safe_url())
