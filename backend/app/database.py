"""Async SQLAlchemy engine/session — source of truth for document and
conversation metadata (Qdrant only stores vectors+payloads, Redis is a
volatile cache, neither is a durable list of "what documents exist")."""
import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db():
    # Import models so their tables are registered on Base.metadata before create_all.
    from app.models import db_models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database ready (%s)", settings.DATABASE_URL)
