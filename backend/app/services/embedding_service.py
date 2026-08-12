from sentence_transformers import SentenceTransformer
import numpy as np
from typing import List, Union
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EmbeddingService:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        logger.info(f"Loading embedding model: {model_name}")
        self.model = SentenceTransformer(model_name)
        self.dimension = self.model.get_sentence_embedding_dimension()
        logger.info(f"Embedding dimension: {self.dimension}")
    
    def encode(self, texts: Union[str, List[str]]) -> np.ndarray:
        """Generate embeddings for text(s)."""
        if isinstance(texts, str):
            texts = [texts]
        embeddings = self.model.encode(texts, show_progress_bar=False)
        return embeddings
    
    def encode_query(self, query: str) -> List[float]:
        """Encode a single query, memoised.

        A transformer forward pass runs on every chat turn and every spoken
        voice turn, and for a business assistant the same handful of questions
        arrive all day ("what are your hours", "do you deliver"). The embedding
        is a pure function of the text, so a cache hit is correct indefinitely —
        there is nothing to invalidate and no TTL to get wrong.

        Normalised first so case and stray whitespace do not each get their own
        entry; nothing that could change meaning is folded.
        """
        from app.services import cache

        return cache.dense_query_cache.get_or_call(
            cache.normalise_query(query),
            lambda text: self.model.encode(text).tolist(),
        )
    
    def encode_documents(self, documents: List[str]) -> List[List[float]]:
        """Encode multiple documents."""
        embeddings = self.model.encode(documents, show_progress_bar=True)
        return embeddings.tolist()
