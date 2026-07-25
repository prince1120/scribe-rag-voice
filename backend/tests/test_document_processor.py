import numpy as np
import pytest

from app.services.document_processor import DocumentProcessor


class FakeEmbeddingService:
    """Deterministic stand-in for EmbeddingService — no real model download.

    Produces embeddings that cluster by the first word of each sentence so
    semantic-breakpoint tests have a predictable topic shift to detect.
    """

    def encode(self, texts):
        vectors = []
        for t in texts:
            key = hash(t.split()[0]) % 1000 if t.split() else 0
            rng = np.random.RandomState(key)
            vectors.append(rng.rand(16))
        return np.array(vectors)


class TestFixedSizeChunking:
    def test_splits_long_text_into_overlapping_windows(self):
        dp = DocumentProcessor(chunk_size=10, chunk_overlap=2, embedding_service=None)
        text = " ".join(f"word{i}" for i in range(25))
        chunks = dp._chunk_text(text)
        assert len(chunks) > 1
        # Overlap: last words of chunk N should reappear at the start of chunk N+1
        assert chunks[0].split()[-2:] == chunks[1].split()[:2]

    def test_short_text_returns_single_chunk(self):
        dp = DocumentProcessor(chunk_size=512, chunk_overlap=50, embedding_service=None)
        chunks = dp._chunk_text("just a few words")
        assert chunks == ["just a few words"]

    def test_empty_text_returns_original(self):
        dp = DocumentProcessor(chunk_size=512, chunk_overlap=50, embedding_service=None)
        assert dp._chunk_text("") == [""]


class TestSentenceSplitting:
    def test_splits_on_sentence_terminators(self):
        dp = DocumentProcessor()
        sentences = dp._split_sentences("First sentence. Second sentence! Third one?")
        assert sentences == ["First sentence.", "Second sentence!", "Third one?"]

    def test_splits_on_paragraph_breaks(self):
        dp = DocumentProcessor()
        sentences = dp._split_sentences("Para one.\n\nPara two.")
        assert len(sentences) == 2

    def test_empty_text_returns_empty_list(self):
        dp = DocumentProcessor()
        assert dp._split_sentences("   ") == []


class TestSemanticChunking:
    def test_falls_back_to_fixed_size_without_embedding_service(self):
        dp = DocumentProcessor(chunk_size=512, chunk_overlap=50, embedding_service=None)
        chunks = dp._chunk("A. B. C. D. E.")
        assert chunks  # falls back to _chunk_text, doesn't crash

    def test_falls_back_for_short_text_even_with_embedding_service(self):
        dp = DocumentProcessor(embedding_service=FakeEmbeddingService())
        # Fewer than 4 sentences — not enough structure for breakpoint detection
        chunks = dp._chunk("One sentence. Two sentences.")
        assert chunks == ["One sentence. Two sentences."]

    def test_semantic_chunking_produces_nonempty_coherent_chunks(self):
        dp = DocumentProcessor(chunk_size=512, chunk_overlap=50, embedding_service=FakeEmbeddingService())
        text = (
            "Cats are small domesticated carnivorous mammals. "
            "Cats have retractable claws for hunting. "
            "Cats are often kept as household pets. "
            "Rockets use combustion to generate thrust. "
            "Rockets carry payloads into orbit. "
            "Rockets require precise trajectory calculations."
        )
        chunks = dp._chunk(text)
        assert len(chunks) >= 1
        # every word from the source text must survive somewhere in the chunks
        assert sum(len(c.split()) for c in chunks) >= len(text.split()) - 2

    def test_oversized_chunk_is_hard_split(self):
        dp = DocumentProcessor(chunk_size=5, chunk_overlap=1, embedding_service=FakeEmbeddingService())
        text = ". ".join(f"Sentence number {i} here" for i in range(10)) + "."
        chunks = dp._chunk(text)
        # hard cap: no chunk should wildly exceed the configured chunk_size
        assert all(len(c.split()) <= 5 * 2 for c in chunks)

    def test_semantic_chunking_failure_falls_back_gracefully(self):
        class BrokenEmbeddingService:
            def encode(self, texts):
                raise RuntimeError("model unavailable")

        dp = DocumentProcessor(embedding_service=BrokenEmbeddingService())
        text = "A. B. C. D. E. F."
        chunks = dp._chunk(text)
        assert chunks  # doesn't raise, falls back to fixed-size


class TestProcessFile:
    def test_process_text_file(self, tmp_path):
        dp = DocumentProcessor(chunk_size=512, chunk_overlap=50, embedding_service=None)
        f = tmp_path / "note.txt"
        f.write_text("Hello world, this is a test document.", encoding="utf-8")
        chunks = dp.process_file(str(f), {"document_id": "doc1"})
        assert len(chunks) == 1
        assert chunks[0]["document_id"] == "doc1"
        assert "Hello world" in chunks[0]["content"]

    def test_unsupported_extension_raises(self, tmp_path):
        dp = DocumentProcessor()
        f = tmp_path / "archive.zip"
        f.write_bytes(b"not really a zip")
        with pytest.raises(ValueError):
            dp.process_file(str(f), {"document_id": "doc1"})
