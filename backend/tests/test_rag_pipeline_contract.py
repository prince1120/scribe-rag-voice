"""The chat routes call both generation methods with one keyword set.

`/query` calls `generate_response` and `/query/stream` calls
`generate_streaming_response` with an identical set of keyword arguments. That
is a contract, and nothing enforced it: `agent_prompt` was added to the
streaming method's signature and to *both* method bodies, but not to the
non-streaming signature — so every `/query` request raised

    TypeError: generate_response() got an unexpected keyword argument 'agent_prompt'

and the endpoint was returning 500 for every caller. No test caught it because
the suite covered prompt assembly, never the call.

These tests are cheap and they close that gap permanently: the first compares
the two signatures directly, the second calls each method the way the routes
actually do, with the transport faked.
"""
import inspect
from types import SimpleNamespace

import pytest

from app.services.rag_pipeline import RAGPipeline


# The exact keyword set both chat routes pass. Kept as a literal rather than
# derived from the signature — deriving it from the thing under test would make
# the test pass no matter what the routes do.
ROUTE_KWARGS = {
    "query",
    "context_chunks",
    "conversation_history",
    "attached_images",
    "temperature",
    "max_tokens",
    "groq_api_key",
    "override_model",
    "custom_base_url",
    "custom_api_key",
    "agent_prompt",
}


def _params(fn) -> set[str]:
    return {
        name
        for name, p in inspect.signature(fn).parameters.items()
        if p.kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }


def test_both_generation_methods_accept_every_keyword_the_routes_send():
    for method in (RAGPipeline.generate_response, RAGPipeline.generate_streaming_response):
        missing = ROUTE_KWARGS - _params(method)
        assert not missing, (
            f"{method.__name__} cannot be called the way the chat routes call it; "
            f"missing parameter(s): {sorted(missing)}"
        )


def test_the_two_methods_have_identical_signatures():
    """They are two transports for one operation. A parameter on one and not the
    other means a caller gets different behaviour depending on whether streaming
    happens to be on — which is exactly how the agent_prompt bug reached
    production."""
    assert _params(RAGPipeline.generate_response) == _params(
        RAGPipeline.generate_streaming_response
    )


class _FakeCompletions:
    """Records the request and returns a minimal Groq/OpenAI-shaped response."""

    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return iter(
                [
                    SimpleNamespace(
                        choices=[SimpleNamespace(delta=SimpleNamespace(content="hello "))]
                    ),
                    SimpleNamespace(
                        choices=[SimpleNamespace(delta=SimpleNamespace(content="world"))]
                    ),
                ]
            )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="hello world"))]
        )


@pytest.fixture
def pipeline(monkeypatch):
    p = RAGPipeline(groq_api_key="test-key", model="test-model")
    fake = _FakeCompletions()
    monkeypatch.setattr(
        p, "_client_for", lambda *a, **k: SimpleNamespace(chat=SimpleNamespace(completions=fake))
    )
    p._fake = fake
    return p


CHUNKS = [
    {
        "display_number": "1.1",
        "payload": {"content": "We are open 9am to 5pm.", "filename": "hours.md"},
    }
]


def _call_kwargs(**overrides):
    base = {
        "query": "what are your hours?",
        "context_chunks": CHUNKS,
        "conversation_history": None,
        "attached_images": None,
        "temperature": 0.1,
        "max_tokens": 200,
        "groq_api_key": None,
        "override_model": None,
        "custom_base_url": None,
        "custom_api_key": None,
        "agent_prompt": "You are Rani, the assistant for Shiro Crafts.",
    }
    base.update(overrides)
    return base


def test_generate_response_accepts_the_full_route_call(pipeline):
    """The regression itself: this raised TypeError before the fix."""
    answer = pipeline.generate_response(**_call_kwargs())
    assert answer == "hello world"


def test_generate_streaming_response_accepts_the_full_route_call(pipeline):
    tokens = list(pipeline.generate_streaming_response(**_call_kwargs()))
    assert "".join(tokens) == "hello world"


@pytest.mark.parametrize("streaming", [False, True])
def test_agent_prompt_leads_the_system_prompt_on_both_paths(pipeline, streaming):
    """The owner's script must reach the model identically either way — the
    whole point of threading agent_prompt through chat was that one assistant
    should not answer differently by channel."""
    script = "You are Rani, the assistant for Shiro Crafts."
    kwargs = _call_kwargs(agent_prompt=script)

    if streaming:
        list(pipeline.generate_streaming_response(**kwargs))
    else:
        pipeline.generate_response(**kwargs)

    system = pipeline._fake.calls[-1]["messages"][0]
    assert system["role"] == "system"
    assert system["content"].startswith(script)


def test_agent_prompt_is_optional(pipeline):
    """Personal workspaces have no agent script; both paths must still work."""
    pipeline.generate_response(**_call_kwargs(agent_prompt=None))
    assert pipeline._fake.calls
