"""Small, dependency-free helpers factored out of routes.py so they can be
unit-tested without importing the module (which eagerly constructs the ML
services — embedding/reranker/vector-store/Groq clients — at import time)."""
import hashlib
import os
import re
from typing import Any, Dict, List

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]")


def derive_demo_tenant_id(groq_key: str) -> str:
    """Derive a stable, isolated tenant id from a visitor-supplied Groq key.

    The key itself is the identity — no login/cookie needed, and the
    'demo-' prefix guarantees it can never collide with the real tenant ids
    used by the app's own (non-demo) traffic.
    """
    digest = hashlib.sha256(groq_key.encode("utf-8")).hexdigest()[:16]
    return f"demo-{digest}"


def sanitize_filename(filename: str) -> str:
    """Strip path components and unsafe characters so a filename can never
    escape the uploads directory (path traversal) or collide with a hidden
    file (leading dot)."""
    name = os.path.basename((filename or "").replace("\x00", ""))
    name = _SAFE_FILENAME_RE.sub("_", name).lstrip(".")
    return name or "upload"


def assign_display_numbers(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Annotate each result with a hierarchical display number like '1.2'.

    First component = document order (per first-seen). Second = chunk order
    within that document. Returns the list with `display_number` set on each.
    """
    doc_order: list = []
    doc_counts: dict = {}
    out = []
    for r in results:
        payload = dict(r.get("payload") or {})
        doc_id = payload.get("document_id") or payload.get("chunk_id") or "unknown"
        if doc_id not in doc_counts:
            doc_order.append(doc_id)
            doc_counts[doc_id] = 0
        doc_counts[doc_id] += 1
        doc_idx = doc_order.index(doc_id) + 1
        chunk_idx = doc_counts[doc_id]
        display = f"{doc_idx}.{chunk_idx}"

        new_r = dict(r)
        new_r["display_number"] = display
        new_r["payload"] = payload
        out.append(new_r)
    return out
