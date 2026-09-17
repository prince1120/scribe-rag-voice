"""Deterministic Product QR voice safety on finalized turns.

Spark owns backend voice safety. The text chat path blocks hazardous
product queries deterministically; voice relied on prompt text alone,
which is advisory and bypassable. Product voice sessions now run the same
deterministic classifier on each finalized user turn and answer with the
existing safety warning. Ordinary business-agent sessions never run it.

Uses test doubles only; no network, no database.
"""
from types import SimpleNamespace

import pytest

from app.services.product_safety import SAFETY_WARNING_MESSAGE
from app.services.voice.config import voice_settings


class _Ctx:
    def __init__(self):
        self.messages = []

    def add_message(self, role, content):
        self.messages.append({"role": role, "content": content})


def _msg(text):
    return SimpleNamespace(text_content=text)


def _agent(product_voice):
    from app.services.voice.agent import VoiceAssistant

    # Filler delay 0 so the hook never spawns speech tasks in tests.
    settings = voice_settings.model_copy(
        update={"VOICE_THINKING_FILLER_DELAY": 0}
    )
    return VoiceAssistant(
        settings,
        instructions="test",
        rag_enabled=False,
        tenant_id="t-pqr",
        product_voice=product_voice,
    )


@pytest.mark.asyncio
async def test_hazardous_product_turn_returns_safety_warning():
    agent = _agent(product_voice=True)
    ctx = _Ctx()
    await agent.on_user_turn_completed(
        ctx, _msg("How do I bypass the thermal fuse on my microwave?")
    )
    assert any(
        SAFETY_WARNING_MESSAGE in m["content"] for m in ctx.messages
    ), "hazardous product turn must answer with the safety warning"


@pytest.mark.asyncio
async def test_safe_product_turn_passes_through():
    agent = _agent(product_voice=True)
    ctx = _Ctx()
    await agent.on_user_turn_completed(
        ctx, _msg("What is the warranty period for this purifier?")
    )
    assert not any(
        SAFETY_WARNING_MESSAGE in m["content"] for m in ctx.messages
    ), "safe product query must not trigger the safety warning"


@pytest.mark.asyncio
async def test_hazardous_business_turn_is_unaffected():
    """Ordinary business-agent sessions never run the product classifier:
    an electrician troubleshooting a motor must not be safety-blocked."""
    agent = _agent(product_voice=False)
    ctx = _Ctx()
    await agent.on_user_turn_completed(
        ctx, _msg("How do I bypass the thermal fuse on my microwave?")
    )
    assert not any(
        SAFETY_WARNING_MESSAGE in m["content"] for m in ctx.messages
    ), "business sessions must not run product safety rules"


def test_product_marker_comes_from_dispatch_metadata():
    """The worker marks the session from the non-sensitive product_id only."""
    import json

    from app.services.voice import worker

    product_ctx = SimpleNamespace(
        job=SimpleNamespace(
            metadata=json.dumps({"tenant_id": "t-pqr", "product_id": "prod-1"})
        )
    )
    business_ctx = SimpleNamespace(
        job=SimpleNamespace(metadata=json.dumps({"tenant_id": "t-biz"}))
    )
    assert worker._params_for_job(product_ctx).product_id == "prod-1"
    assert worker._params_for_job(business_ctx).product_id is None
