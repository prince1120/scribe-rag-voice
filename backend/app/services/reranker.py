"""Reranker removed — hybrid search (dense + BM25 with RRF) provides ranking with zero reranker latency."""
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)


class Reranker:
    """No-op stub for backwards compatibility without heavy model dependencies."""
    def __init__(self, *args, **kwargs):
        pass

    def rerank(
        self,
        query: str,
        candidates: List[Dict],
        top_k: int,
    ) -> List[Dict]:
        return candidates[:top_k]