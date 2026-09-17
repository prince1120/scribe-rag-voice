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
    """Postgres needs pooler-friendly settings; SQLite needs none.
    Passing postgres args to SQLite raises, so branch strictly."""
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


def _is_production_db() -> bool:
    """True when DATABASE_URL points at a real Postgres (self-hosted or Supabase).
    Used to fail fast rather than silently creating a local SQLite fallback."""
    return settings.DATABASE_URL.startswith("postgresql")


# Lightweight local tests may explicitly opt into SQLite via env:
#   SCRIBE_ALLOW_SQLITE=true pytest ...
# Production (DEBUG=false) with SQLite is a durability trap and should warn.


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
    # Agents
    ("agents", "style_rules_enabled", "BOOLEAN NOT NULL DEFAULT true"),
    ("agents", "voice_script", "TEXT"),
    ("agents", "chat_script", "TEXT"),
    ("agents", "voice_model", "VARCHAR(120)"),
    ("agents", "chat_model", "VARCHAR(120)"),
    ("agents", "voice_base_url", "VARCHAR(500)"),
    ("agents", "voice_api_key_enc", "TEXT"),
    ("agents", "chat_base_url", "VARCHAR(500)"),
    ("agents", "chat_api_key_enc", "TEXT"),
    ("agents", "voice_temperature", "FLOAT"),
    ("agents", "voice_max_tokens", "INTEGER"),
    ("agents", "chat_temperature", "FLOAT"),
    ("agents", "chat_max_tokens", "INTEGER"),
    ("agents", "deployed_at", "TIMESTAMP WITH TIME ZONE"),

    # Owners
    ("owners", "public_handle", "VARCHAR(32)"),
    ("owners", "email", "VARCHAR(320)"),
    ("owners", "password_hash", "VARCHAR(200)"),
    ("owners", "business_name", "VARCHAR(200)"),
    ("owners", "business_category", "VARCHAR(64)"),
    ("owners", "mode_chosen_at", "TIMESTAMP WITH TIME ZONE"),
    ("owners", "groq_key_enc", "TEXT"),
    ("owners", "sarvam_key_enc", "TEXT"),
    ("owners", "mistral_key_enc", "TEXT"),
    ("owners", "custom_llm_key_enc", "TEXT"),
    ("owners", "custom_llm_base_url", "VARCHAR(500)"),
    ("owners", "llm_model", "VARCHAR(120)"),

    # Contacts
    ("contacts", "source", "VARCHAR(16) NOT NULL DEFAULT 'owner'"),
    ("contacts", "client_id", "VARCHAR(64)"),
    ("contacts", "bound_device", "VARCHAR(64)"),
    ("contacts", "pin", "VARCHAR(12)"),
    ("contacts", "revoked_at", "TIMESTAMP WITH TIME ZONE"),
    ("contacts", "blocked_at", "TIMESTAMP WITH TIME ZONE"),
    ("contacts", "expires_at", "TIMESTAMP WITH TIME ZONE"),
    ("contacts", "max_sessions_per_day", "INTEGER DEFAULT 20"),
    ("contacts", "last_seen_at", "TIMESTAMP WITH TIME ZONE"),

    # Contact Sessions
    ("contact_sessions", "duration_seconds", "INTEGER NOT NULL DEFAULT 0"),
    ("contact_sessions", "conversation_id", "VARCHAR(36)"),
    ("contact_sessions", "ip_address", "VARCHAR(64)"),
    ("contact_sessions", "user_agent", "VARCHAR(300)"),
    ("contact_sessions", "device_id", "VARCHAR(64)"),
    ("contact_sessions", "channel", "VARCHAR(16) DEFAULT 'chat'"),
    ("contact_sessions", "last_activity_at", "TIMESTAMP WITH TIME ZONE"),
    ("contact_sessions", "message_count", "INTEGER DEFAULT 0"),

    # Documents
    ("documents", "agent_enabled", "BOOLEAN NOT NULL DEFAULT true"),
    ("documents", "file_size", "INTEGER DEFAULT 0"),
    ("documents", "chunk_count", "INTEGER DEFAULT 0"),
    ("documents", "status", "VARCHAR(32) DEFAULT 'processed'"),
    ("documents", "purpose", "VARCHAR(16) DEFAULT 'rag'"),
    ("documents", "source_snapshot_id", "VARCHAR(36)"),
    ("agents", "voice_rag_enabled", "BOOLEAN"),
    ("agents", "chat_rag_enabled", "BOOLEAN"),

    # Products & Product QR (M1A)
    ("products", "is_active", "BOOLEAN NOT NULL DEFAULT true"),
    ("products", "short_description", "TEXT"),
    ("products", "support_disclaimer", "TEXT"),
    ("products", "status", "VARCHAR(16) NOT NULL DEFAULT 'active'"),
    ("product_qr_links", "label", "VARCHAR(200)"),
    ("product_qr_links", "public_token_hash", "VARCHAR(64)"),
    ("product_qr_links", "active", "BOOLEAN NOT NULL DEFAULT true"),
    ("product_qr_links", "revoked_at", "TIMESTAMP WITH TIME ZONE"),
    ("product_qr_links", "updated_at", "TIMESTAMP WITH TIME ZONE"),
    ("product_visitor_sessions", "qr_link_id", "VARCHAR(36)"),
    ("product_visitor_sessions", "session_token_hash", "VARCHAR(64)"),
    ("product_visitor_sessions", "last_seen_at", "TIMESTAMP WITH TIME ZONE"),
    ("product_visitor_sessions", "expires_at", "TIMESTAMP WITH TIME ZONE"),
    ("product_visitor_sessions", "revoked_at", "TIMESTAMP WITH TIME ZONE"),
    # Voice calls created from Product QR have no named contact. Preserve a
    # human-readable product/model label so owners can identify them in Inbox.
    ("voice_calls", "context_label", "VARCHAR(240)"),
    ("voice_calls", "voice_consent_at", "TIMESTAMP WITH TIME ZONE"),
]


# Composite indexes matching the query shapes this app actually issues.
#
# The single-column indexes declared on the models cover the equality half of
# each query, but every list endpoint is "filter by owner, then ORDER BY a
# timestamp" — which without a composite means the database finds the rows by
# index and then sorts them, a cost that grows with how much history a tenant
# has. These are the shapes, one per line, with the query they serve.
#
# Written as raw `CREATE INDEX IF NOT EXISTS` rather than `__table_args__`
# because `create_all` does not add an index to a table it already sees, and
# every deployed database already has these tables. The statement is valid and
# idempotent in both SQLite and Postgres, so this runs on every boot as a no-op.
_ADDED_INDEXES: list[tuple[str, str]] = [
    # repositories.list_documents
    ("ix_documents_tenant_created", "documents (tenant_id, created_at DESC)"),
    # repositories.list_conversations
    ("ix_conversations_tenant_updated", "conversations (tenant_id, updated_at DESC)"),
    # ConversationRecord.messages, always read in chronological order
    ("ix_messages_conversation_created", "messages (conversation_id, created_at)"),
    # repositories.list_contacts
    ("ix_contacts_owner_created", "contacts (owner_tenant_id, created_at DESC)"),
    # list_contact_sessions, count_sessions_since (the per-day cap, on the
    # unauthenticated /contacts/open path), and the overview aggregation
    ("ix_sessions_contact_started", "contact_sessions (contact_id, started_at DESC)"),
    # Product QR lookups (M1A)
    ("ix_products_tenant_created", "products (tenant_id, created_at DESC)"),
    ("ix_product_documents_product", "product_documents (product_id, document_id)"),
    ("ix_product_links_product_created", "product_qr_links (product_id, created_at DESC)"),
    ("ix_product_sessions_link_created", "product_visitor_sessions (qr_link_id, created_at DESC)"),
]


def _apply_added_indexes(connection) -> None:
    """Create any missing index from `_ADDED_INDEXES`.

    Failures are logged and skipped for the same reason as the column
    migrations: a missing index makes queries slower, while refusing to boot
    makes them impossible.
    """
    from sqlalchemy import text

    for name, target in _ADDED_INDEXES:
        try:
            connection.execute(
                text(f"CREATE INDEX IF NOT EXISTS {name} ON {target}")
            )
        except Exception:
            logger.warning("Could not create index %s", name, exc_info=True)


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

    # Do not silently fall back to SQLite when running outside DEBUG. A missing
    # or mis-typed DATABASE_URL that quietly creates ./rag.db is a data-loss
    # trap (ephemeral disk, no backup) that looks healthy until the next deploy.
    import os as _os

    allow_sqlite = _os.getenv("SCRIBE_ALLOW_SQLITE", "").lower() in ("1", "true", "yes")
    if not _is_production_db() and not settings.DEBUG and not allow_sqlite:
        raise RuntimeError(
            "DATABASE_URL is not postgresql:// — refusing to boot with SQLite in "
            "non-DEBUG mode. Set DATABASE_URL to your Compose Postgres "
            "(postgresql+asyncpg://...@postgres:5432/...) or export "
            "SCRIBE_ALLOW_SQLITE=true for a throwaway local test."
        )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_apply_added_columns)
        # After the columns: an index may reference a column added above.
        await conn.run_sync(_apply_added_indexes)
    logger.info("Database ready (%s)", _safe_url())
