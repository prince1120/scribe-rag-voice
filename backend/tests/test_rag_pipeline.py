import pytest

from app.services.rag_pipeline import RAGPipeline


@pytest.fixture
def pipeline():
    # Groq client construction doesn't make network calls, safe to build
    # with a fake key for testing pure prompt/context-building logic.
    return RAGPipeline(groq_api_key="fake-key", model="test-model", vision_model="test-vision-model")


class TestTruncateToTokens:
    def test_short_text_unchanged(self, pipeline):
        text = "hello world"
        assert pipeline._truncate_to_tokens(text, 100) == text

    def test_zero_budget_returns_empty(self, pipeline):
        assert pipeline._truncate_to_tokens("hello world", 0) == ""

    def test_long_text_gets_truncated_with_ellipsis(self, pipeline):
        text = "word " * 500
        out = pipeline._truncate_to_tokens(text, 10)
        assert out.endswith("…")
        assert len(out) < len(text)


class TestBuildContext:
    def test_includes_source_headers_with_display_number(self, pipeline):
        chunks = [
            {"display_number": "1.1", "payload": {"filename": "a.pdf", "content": "Some content."}},
        ]
        context, allowed_ids = pipeline._build_context(chunks, max_context_tokens=1000)
        assert "[Source 1.1]" in context
        assert "a.pdf" in context
        assert allowed_ids == ["1.1"]

    def test_respects_token_budget_by_stopping_early(self, pipeline):
        chunks = [
            {"display_number": f"1.{i}", "payload": {"content": "word " * 200}}
            for i in range(1, 20)
        ]
        context, allowed_ids = pipeline._build_context(chunks, max_context_tokens=50)
        # Budget is tiny — shouldn't fit all 19 chunks
        assert len(allowed_ids) < len(chunks)

    def test_empty_chunks_returns_empty_context(self, pipeline):
        context, allowed_ids = pipeline._build_context([], max_context_tokens=1000)
        assert context == ""
        assert allowed_ids == []


class TestStripThinkTag:
    def test_removes_think_block(self, pipeline):
        text = "<think>internal reasoning</think>The actual answer."
        assert pipeline._strip_think_tag(text) == "The actual answer."

    def test_no_think_block_unchanged(self, pipeline):
        text = "Just a normal answer."
        assert pipeline._strip_think_tag(text) == text

    def test_empty_text(self, pipeline):
        assert pipeline._strip_think_tag("") == ""


class TestBuildHistory:
    def test_no_history_returns_empty_string(self, pipeline):
        assert pipeline._build_history(None) == ""
        assert pipeline._build_history([]) == ""

    def test_recent_turns_included(self, pipeline):
        history = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        rendered = pipeline._build_history(history, max_tokens=500, max_turns=4)
        assert "hi" in rendered
        assert "hello" in rendered

    def test_only_recent_max_turns_kept(self, pipeline):
        history = [{"role": "user", "content": f"msg{i}"} for i in range(10)]
        rendered = pipeline._build_history(history, max_tokens=5000, max_turns=2)
        assert "msg8" in rendered and "msg9" in rendered
        assert "msg0" not in rendered


class TestModelExtraKwargs:
    def test_gpt_oss_gets_reasoning_effort(self, pipeline):
        kw = pipeline._model_extra_kwargs("openai/gpt-oss-20b")
        assert kw == {"reasoning_effort": "low"}

    def test_other_models_get_no_extra_kwargs(self, pipeline):
        assert pipeline._model_extra_kwargs("llama-3.1-8b-instant") == {}
