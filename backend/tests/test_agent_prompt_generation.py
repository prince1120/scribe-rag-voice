import json

import httpx

from app.services import prompt_rules, site_ingest


def test_source_prompt_keeps_contact_and_bounds_voice_context():
    pages = [{"title": "Clinic", "url": "", "text": "CONTACT INFO:\n- Phone: +91 9876543210\n\nConsultation costs 500 rupees. " + "Our team offers consultation by appointment. " * 300}]
    prompt = site_ingest.build_prompt_from_site(pages, {"name": "Asha", "business": "Clinic"})
    assert len(prompt["voice_script"]) <= 4500
    assert "9876543210" in prompt["voice_script"]
    assert "Asha" in prompt["voice_script"]
    assert "name and phone" in prompt["voice_script"]
    assert "invite the caller to keep talking" not in prompt_rules.VOICE_DELIVERY
    assert len(prompt_rules.VOICE_DELIVERY) < 1600


async def test_generation_uses_workspace_sarvam_key_without_thinking(monkeypatch):
    observed = []
    original_client = httpx.AsyncClient

    async def respond(request):
        observed.append(request)
        result = {"voice_script": "You are Asha, the assistant for Clinic. Answer only from verified business facts and use available tools for current availability. Ask only for missing customer details.",
                  "chat_script": "You are Asha, the assistant for Clinic. Answer only from verified business facts and use available tools for current availability. Ask only for missing customer details.", "greeting": "Hi, I'm Asha from Clinic. How can I help?"}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(result)}}]})

    monkeypatch.setattr(site_ingest.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs))
    result = await site_ingest.build_agent_prompts([{ "title": "Clinic", "url": "", "text": "Consultation by appointment."}], {"name": "Asha"}, sarvam_api_key="workspace-test-key")
    assert len(observed) == 1
    request = observed[0]
    assert str(request.url) == "https://api.sarvam.ai/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer workspace-test-key"
    payload = json.loads(request.content)
    assert payload["model"] == "sarvam-105b-conversations"
    assert payload["reasoning_effort"] is None
    assert "untrusted business data" in payload["messages"][1]["content"]
    assert result["voice_script"].startswith("You are Asha")
