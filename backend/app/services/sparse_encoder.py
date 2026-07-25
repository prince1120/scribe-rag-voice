"""BM25 sparse vector encoder for hybrid retrieval.

Wraps fastembed's `Bm25` model, which is purpose-built to produce sparse
vectors compatible with Qdrant's sparse indexing.
"""
import logging
from typing import Iterable, List

from fastembed import SparseTextEmbedding

logger = logging.getLogger(__name__)


class SparseEncoder:
    """Produces (indices, values) BM25 sparse vectors."""

    def __init__(self, model_name: str = "Qdrant/bm25"):
        logger.info(f"Loading sparse model: {model_name}")
        self.model = SparseTextEmbedding(model_name=model_name)
        self.model_name = model_name

    def _encode(self, texts: List[str]) -> List[dict]:
        results = []
        for emb in self.model.embed(texts):
            results.append({
                "indices": emb.indices.tolist(),
                "values": emb.values.tolist(),
            })
        return results

    def encode_documents(self, texts: Iterable[str]) -> List[dict]:
        return self._encode(list(texts))

    def encode_query(self, text: str) -> dict:
        # Use query embedding for retrieval-time sparsification (different from doc-time)
        emb = next(self.model.query_embed([text]))
        return {
            "indices": emb.indices.tolist(),
            "values": emb.values.tolist(),
        }