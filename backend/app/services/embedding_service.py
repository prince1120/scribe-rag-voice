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
        """Encode a single query."""
        embedding = self.model.encode(query)
        return embedding.tolist()
    
    def encode_documents(self, documents: List[str]) -> List[List[float]]:
        """Encode multiple documents."""
        embeddings = self.model.encode(documents, show_progress_bar=True)
        return embeddings.tolist()
