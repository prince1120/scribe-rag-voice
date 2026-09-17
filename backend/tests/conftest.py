"""Test-session isolation: local stores by default, hard guard otherwise.

Imported by pytest before any test module (and therefore before `app.*`),
so the environment below is what the application settings are built from.

- Default: tests run against an isolated throwaway SQLite file plus
  localhost Qdrant/Redis endpoints (both tolerated absent: the vector store
  degrades and conversations fall back to memory). No test may silently
  read or write Supabase, Qdrant Cloud, or any other shared remote
  infrastructure.
- Escape hatch: `SCRIBE_INTEGRATION_TESTS=1` keeps the configured remote
  endpoints for an explicit integration run.
- Hard guard: an explicitly exported cloud DATABASE_URL/QDRANT_HOST fails
  fast with a clear message (naming the variable, never its value) unless
  the integration flag is set.

Only the `test_isolated.db` file is ever reset here — real data files
(`rag.db`, user uploads) are never touched.
"""
import os
from pathlib import Path

# Substrings marking hosted infrastructure. Matched case-insensitively
# against variable values that are never printed.
_CLOUD_MARKERS = (
    "supabase.co",
    "amazonaws.com",
    "neon.tech",
    "qdrant.io",
    "planetscale",
    "railway.app",
    "render.com",
    "fly.dev",
    "cockroachcloud",
    "turso.io",
    "aiven.io",
    "mongodb.net",
    "azure.com",
)

_GUARDED_VARS = ("DATABASE_URL", "QDRANT_HOST")

_INTEGRATION = os.getenv("SCRIBE_INTEGRATION_TESTS") == "1"


def _mentions_cloud(value: str) -> bool:
    lowered = (value or "").lower()
    return any(marker in lowered for marker in _CLOUD_MARKERS)


if not _INTEGRATION:
    for _var in _GUARDED_VARS:
        if _mentions_cloud(os.environ.get(_var, "")):
            raise RuntimeError(
                f"Refusing to run tests: {_var} points at hosted "
                "infrastructure. Unset it to use the isolated local test "
                "stores, or set SCRIBE_INTEGRATION_TESTS=1 to explicitly "
                "allow a remote integration run."
            )

    # Isolated defaults. Environment wins over .env files in
    # pydantic-settings, so assigning here overrides backend/.env.
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_isolated.db"
    os.environ["SCRIBE_ALLOW_SQLITE"] = "true"
    os.environ["QDRANT_HOST"] = "127.0.0.1"
    os.environ["QDRANT_PORT"] = "6333"
    os.environ["QDRANT_API_KEY"] = ""
    os.environ["QDRANT_HTTPS"] = "false"
    os.environ["REDIS_HOST"] = "127.0.0.1"
    os.environ["REDIS_PORT"] = "6379"

    # Fresh throwaway database per session. This filename belongs to tests
    # only; nothing else in the repo reads or writes it.
    _stale = Path(__file__).resolve().parent.parent / "test_isolated.db"
    _stale.unlink(missing_ok=True)
