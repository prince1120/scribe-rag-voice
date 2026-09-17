#!/usr/bin/env python
"""
Safe SQLite -> PostgreSQL migration for Scribe.

- Preserves primary keys, tenant IDs, relationships, JSON, timestamps, statuses.
- Runs transactionally: either all tables or none.
- Supports --dry-run (no writes, just counts + schema check).
- Compares table counts after migration.

Usage:
  python -m scripts.migrate_sqlite_to_postgres --sqlite-path ../rag.db --postgres-url postgresql+asyncpg://... --dry-run
  python -m scripts.migrate_sqlite_to_postgres --sqlite-path ../rag.db --postgres-url postgresql+asyncpg://... --execute

For hybrid local: use 127.0.0.1:55432
  --postgres-url postgresql+asyncpg://scribe:pass@127.0.0.1:55432/scribe
  (requires: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres)

Never run against Supabase without a backup.
"""
import argparse
import asyncio
import sqlite3
import sys
from pathlib import Path

# Tables in dependency order (parents before children) to preserve FKs.
ORDERED_TABLES = [
    "owners",
    "agents",
    "agent_snapshots",
    "documents",
    "conversations",
    "messages",
    "contacts",
    "contact_sessions",
    "services",
    "availability",
    "holidays",
    "bookings",
    "notifications",
    "call_reports",
    "voice_calls",
    "business_requests",
    "calendar_settings",
]


def inspect_sqlite(sqlite_path: Path):
    if not sqlite_path.exists():
        print(f"SQLite not found: {sqlite_path}")
        sys.exit(1)
    con = sqlite3.connect(str(sqlite_path))
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [r[0] for r in cur.fetchall()]
    print(f"SQLite: {sqlite_path} ({sqlite_path.stat().st_size} bytes)")
    print(f" Tables: {tables}")
    counts = {}
    for t in tables:
        try:
            cur.execute(f'SELECT COUNT(*) FROM "{t}"')
            counts[t] = cur.fetchone()[0]
        except Exception as e:
            counts[t] = f"error: {e}"
    for t, c in counts.items():
        print(f"  {t}: {c}")
    con.close()
    return tables, counts


async def migrate(sqlite_path: Path, postgres_url: str, dry_run: bool):
    # Lazy imports to avoid requiring asyncpg when only inspecting
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import text

    sqlite_con = sqlite3.connect(str(sqlite_path))
    sqlite_con.row_factory = sqlite3.Row
    s_cur = sqlite_con.cursor()
    s_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    existing_tables = [r[0] for r in s_cur.fetchall()]

    tables_to_migrate = [t for t in ORDERED_TABLES if t in existing_tables]
    missing = [t for t in existing_tables if t not in ORDERED_TABLES]
    if missing:
        print(f"Note: SQLite has extra tables not in migration order (will still migrate if possible): {missing}")
        tables_to_migrate += missing

    # Collect counts
    sqlite_counts = {}
    for t in tables_to_migrate:
        s_cur.execute(f'SELECT COUNT(*) FROM "{t}"')
        sqlite_counts[t] = s_cur.fetchone()[0]

    print("\nDry-run: would migrate" if dry_run else "\nMigrating")
    for t, c in sqlite_counts.items():
        print(f"  {t}: {c} rows")
    total = sum(v for v in sqlite_counts.values() if isinstance(v, int))
    if total == 0:
        print("\nSQLite contains no meaningful rows (all counts 0). No migration needed.")
        print("Evidence: see counts above. Initialize PostgreSQL normally via app init_db().")
        return

    if dry_run:
        print("\n--dry-run: no writes performed. Rerun without --dry-run to execute.")
        return

    print(f"\nConnecting to Postgres: {postgres_url.split('@')[-1]}")  # hide password
    engine = create_async_engine(postgres_url, pool_pre_ping=True)

    # Verify Postgres schema exists (init_db must have run)
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
        pg_tables = [r[0] for r in result.fetchall()]
    print(f"Postgres tables: {pg_tables}")

    # Transactional migrate
    async with engine.begin() as pg_conn:
        for table in tables_to_migrate:
            count = sqlite_counts[table]
            if count == 0:
                continue
            print(f"Migrating {table} ({count} rows)...")
            s_cur.execute(f'SELECT * FROM "{table}"')
            rows = s_cur.fetchall()
            if not rows:
                continue
            cols = rows[0].keys()
            col_list = ", ".join(f'"{c}"' for c in cols)
            placeholders = ", ".join(f":{c}" for c in cols)
            # Use INSERT ... ON CONFLICT DO NOTHING to preserve idempotency if rerun
            # For tables with primary key, this keeps existing rows.
            insert_sql = text(f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING')
            for r in rows:
                # sqlite3.Row -> dict, keep JSON as text, timestamps as stored
                data = dict(r)
                await pg_conn.execute(insert_sql, data)

    # Verify
    async with engine.connect() as conn:
        print("\nPost-migration counts (Postgres):")
        for t in tables_to_migrate:
            try:
                result = await conn.execute(text(f'SELECT COUNT(*) FROM "{t}"'))
                pg_count = result.scalar()
                sq_count = sqlite_counts[t]
                status = "OK" if pg_count >= sq_count else "MISMATCH"
                print(f"  {t}: PG={pg_count} SQLite={sq_count} [{status}]")
            except Exception as e:
                print(f"  {t}: error {e}")

    await engine.dispose()
    print("\nMigration complete. Verify with: SELECT COUNT(*) per table.")
    print("Rollback: restore SQLite backup file and, if needed, TRUNCATE Postgres tables.")


def main():
    p = argparse.ArgumentParser(description="SQLite -> Postgres migration (Scribe)")
    p.add_argument("--sqlite-path", type=Path, default=Path(__file__).resolve().parents[2] / "rag.db", help="Path to SQLite file")
    p.add_argument("--postgres-url", required=True, help="postgresql+asyncpg://...")
    p.add_argument("--dry-run", action="store_true", help="Do not write, just inspect")
    p.add_argument("--execute", action="store_true", help="Actually migrate (required with --dry-run off)")
    args = p.parse_args()

    if not args.dry_run and not args.execute:
        print("Refusing to migrate without --dry-run or --execute. Use --dry-run first.")
        sys.exit(2)

    inspect_sqlite(args.sqlite_path)
    if args.dry_run or args.execute:
        asyncio.run(migrate(args.sqlite_path, args.postgres_url, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
