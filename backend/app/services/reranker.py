"""Cross-encoder reranker for the final retrieval stage.

Cross-encoders score (query, doc) pairs jointly and produce far more
accurate relevance scores than bi-encoder cosine similarity, at the cost
of latency. We only run it on the top-N hybrid candidates, then keep
the top-K best for the LLM.

Uses FlashRank (ONNX runtime, no PyTorch) instead of sentence-transformers'
CrossEncoder — same pairwise cross-encoder scoring, but noticeably faster
on CPU since there's no torch graph overhead per request.
"""
import logging
import os
from typing import List, Dict

from flashrank import Ranker, RerankRequest

logger = logging.getLogger(__name__)

# backend/.cache/flashrank — project-local so the downloaded model survives
# reboots/temp cleanup instead of living in the OS temp dir.
_DEFAULT_CACHE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "flashrank")
)


class Reranker:
    def __init__(
        self,
        model_name: str = "ms-marco-TinyBERT-L-2-v2",
        cache_dir: str = _DEFAULT_CACHE_DIR,
    ):
        logger.info(f"Loading FlashRank reranker: {model_name}")
        self.model = Ranker(model_name=model_name, cache_dir=cache_dir, max_length=512)
        self.model_name = model_name

    def rerank(
        self,
        query: str,
        candidates: List[Dict],
        top_k: int,
    ) -> List[Dict]:
        """Rerank candidates by cross-encoder score; return top_k.

        Each candidate must have payload['content']. Adds 'rerank_score'
        to each returned item and sorts descending.
        """
        if not candidates:
            return []

        passages = [
            {"id": i, "text": (c.get("payload") or {}).get("content", "")}
            for i, c in enumerate(candidates)
        ]
        results = self.model.rerank(RerankRequest(query=query, passages=passages))
        scores_by_id = {r["id"]: float(r["score"]) for r in results}

        scored = [
            {**cand, "rerank_score": scores_by_id.get(i, 0.0)}
            for i, cand in enumerate(candidates)
        ]
        scored.sort(key=lambda c: c["rerank_score"], reverse=True)
        return scored[:top_k]