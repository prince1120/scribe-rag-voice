"""In-process caches.

Deliberately in-process rather than Redis. The values cached here are either
pure functions of their input (query embeddings) or small per-tenant
configuration read on every single turn — both are cheaper to keep next to the
code that needs them than to fetch over a socket, and neither is worth a network
round trip to share.

That choice has a cost, and it is the reason this module is one file: the moment
the API runs more than one process, `TTLCache` entries diverge between workers
and an invalidation in one is invisible to the others. Nothing here is a
correctness boundary — every entry has a TTL measured in tens of seconds, so
divergence self-heals — but a genuinely multi-worker deployment should move
`config_cache` and any retrieval cache to Redis and leave `keyed_lru` local
(it caches CPU output, not shared state).

Threading: the API mixes async handlers with `run_in_threadpool`, so both are
guarded by a plain `threading.Lock`. The critical sections are dict operations,
so contention is not a concern; correctness under two threads racing the same
key is.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Hashable, Optional

logger = logging.getLogger(__name__)


class TTLCache:
    """A dict whose entries expire, with a bound on how large it can grow.

    `max_entries` matters more than it looks: the natural key here is the tenant
    id, and tenant ids are minted by anyone who pastes an API key
    (`tenant_service.derive_tenant_id`). Without a bound, a caller cycling keys
    would grow this until the process died.
    """

    def __init__(self, *, default_ttl: float, max_entries: int = 2048, name: str = "cache"):
        self._store: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._default_ttl = default_ttl
        self._max_entries = max_entries
        self._name = name
        self.hits = 0
        self.misses = 0

    def get(self, key: Hashable) -> Optional[Any]:
        """The cached value, or None if absent or expired.

        None is not distinguishable from "cached None" — callers here never
        cache None, and `get_or_load` treats a None load result as
        uncacheable, which is the behaviour we want for a failed lookup.
        """
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return None
            expires_at, value = entry
            if now >= expires_at:
                del self._store[key]
                self.misses += 1
                return None
            self._store.move_to_end(key)
            self.hits += 1
            return value

    def set(self, key: Hashable, value: Any, ttl: Optional[float] = None) -> None:
        expires_at = time.monotonic() + (ttl if ttl is not None else self._default_ttl)
        with self._lock:
            self._store[key] = (expires_at, value)
            self._store.move_to_end(key)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)

    def invalidate(self, key: Hashable) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    async def get_or_load(
        self, key: Hashable, loader: Callable, ttl: Optional[float] = None
    ) -> Any:
        """Cached value, or await `loader()` and cache what it returns.

        Two callers missing the same key will both run the loader. That is
        intentional — holding the lock across an await would serialise every
        request behind the slowest database call, and the loaders here are
        idempotent reads where a duplicate costs one extra query, not a wrong
        answer.
        """
        cached = self.get(key)
        if cached is not None:
            return cached
        value = await loader()
        if value is not None:
            self.set(key, value, ttl)
        return value

    def stats(self) -> dict:
        total = self.hits + self.misses
        with self._lock:
            size = len(self._store)
        return {
            "name": self._name,
            "entries": size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
        }


class KeyedLRU:
    """A bounded LRU for pure functions of a string.

    Used for query encoders. The value is a plain function of the text, so there
    is no TTL and no invalidation — a hit is always correct, forever. Keys are
    hashed rather than stored: a query can be arbitrarily long, and keeping the
    full text as a dict key would hold user input in memory for no reason.
    """

    def __init__(self, *, max_entries: int = 512, name: str = "lru"):
        self._store: OrderedDict[str, Any] = OrderedDict()
        self._lock = threading.Lock()
        self._max_entries = max_entries
        self._name = name
        self.hits = 0
        self.misses = 0

    @staticmethod
    def key_for(text: str) -> str:
        return hashlib.sha1(text.encode("utf-8"), usedforsecurity=False).hexdigest()

    def get_or_call(self, text: str, fn: Callable[[str], Any]) -> Any:
        key = self.key_for(text)
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
                self.hits += 1
                return self._store[key]
        # Computed outside the lock: this runs a transformer forward pass, and
        # holding the lock across it would serialise every concurrent query.
        self.misses += 1
        value = fn(text)
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)
        return value

    def stats(self) -> dict:
        total = self.hits + self.misses
        with self._lock:
            size = len(self._store)
        return {
            "name": self._name,
            "entries": size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
        }


def normalise_query(text: str) -> str:
    """Fold trivial spelling differences so near-identical questions share an entry.

    "What are your hours?" and "what are your hours" are the same lookup, and a
    business assistant is asked the same handful of questions all day. Only
    case, surrounding whitespace, and internal runs of whitespace are folded —
    nothing that could change meaning.
    """
    return " ".join(text.lower().split())


# ---- Shared instances -------------------------------------------------------

# Per-tenant agent/workspace/credentials. Short TTL because it is invalidated
# explicitly on every write that changes it (see `invalidate_tenant`) — the TTL
# is the backstop for a write path someone forgets to wire up, not the primary
# mechanism.
CONFIG_TTL_S = 45.0
config_cache = TTLCache(default_ttl=CONFIG_TTL_S, max_entries=4096, name="tenant-config")

# Dense and sparse query encoders. Pure, so no TTL.
dense_query_cache = KeyedLRU(max_entries=512, name="dense-query")
sparse_query_cache = KeyedLRU(max_entries=512, name="sparse-query")


def invalidate_tenant(tenant_id: str) -> None:
    """Drop every cached entry for one tenant.

    Called from the write paths that change what the chat and voice turns read:
    agent config, provider credentials, workspace profile, and deploy state.
    Cheap and blunt on purpose — a tenant has a handful of entries, and a
    precise invalidation that misses one produces an owner editing their prompt
    and watching nothing change, which is the bug this exists to prevent.
    """
    if not tenant_id:
        return
    for prefix in ("agent", "owner", "creds", "channels"):
        config_cache.invalidate((prefix, tenant_id))


def all_stats() -> list[dict]:
    return [
        config_cache.stats(),
        dense_query_cache.stats(),
        sparse_query_cache.stats(),
    ]
