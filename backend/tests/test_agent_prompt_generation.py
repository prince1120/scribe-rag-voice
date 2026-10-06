import json
import pytest
from app.services import site_ingest, owner_service


def test_source_prompt_preserves_end_of_documents_and_same_title_pages():
    pages = [
        {"title": "Clinic", "url": "https://example.com/fees", "text": "Phone +91 9876543210. " + "Consultation by appointment. " * 160 + "Refunds require a receipt within 17 days."},
        {"title": "Clinic", "url": "https://example.com/policy", "text": "Emergency visits cost 875 rupees, excluding imaging."},
    ]
    prompt = site_ingest.build_prompt_from_site(site_ingest._dedupe_pages(pages), {"name": "Asha"})
    for channel in ("voice_script", "chat_script"):
        context = prompt[channel].split("SOURCE DATA JSON\n", 1)[1].split("\n\nCONVERSATION", 1)[0]
        assert [item["content"] for item in json.loads(context)] == [page["text"] for page in pages]
        assert len(prompt[channel]) <= 20000
        assert "untrusted reference data" in prompt[channel]
        assert "completed callback" in prompt[channel]


def test_oversize_source_is_rejected_instead_of_cut():
    with pytest.raises(site_ingest.PromptCapacityError, match="No source facts have been silently cut"):
        site_ingest.build_prompt_from_site([{"title": "Book", "text": "Long policy. " * 2000}])


async def test_generation_is_deterministic_without_provider_calls(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Compilation must not spend provider tokens")
    monkeypatch.setattr(site_ingest.httpx, "AsyncClient", forbidden)
    pages = [{"title": "Clinic", "text": "Consultation costs 500 rupees."}]
    assert await site_ingest.build_agent_prompts(pages, sarvam_api_key="test") == site_ingest.build_prompt_from_site(pages)


def test_prompt_cache_prefix_does_not_change_with_clock(monkeypatch):
    from app.services.rag_pipeline import RAGPipeline
    pipeline = RAGPipeline("test-key")
    def messages(clock):
        monkeypatch.setattr(owner_service, "current_context_line", lambda _: "\n\nCURRENT DATE AND TIME\n" + clock)
        prompt = owner_service.build_agent_prompt(script="Verified prices: consultation 500 rupees.", agent_name="Asha", channel="chat")
        return pipeline._prepare_request("Price?", [], [], None, None, prompt, "TEST")[0]
    first, second = messages("Monday 10:00"), messages("Monday 10:01")
    marker = "\n\nCURRENT DATE AND TIME\n"
    assert first[0]["content"].split(marker)[0] == second[0]["content"].split(marker)[0]
    assert first[0]["content"] != second[0]["content"]
    assert first[1] == second[1]
