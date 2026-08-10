"""Models the app offers by name.

Served from the backend rather than hardcoded in each UI. The personal app and
the owner console both need this list, and two copies drift — one gains a model
the other does not, and a picker offers something the server cannot run.

These are Groq-hosted names. Anything else is reachable through a custom
OpenAI-compatible provider, which is why this list does not try to be
exhaustive: it is the shortlist someone picks from without research, not a
registry.
"""

GROQ_MODELS: list[dict[str, str]] = [
    {
        "id": "llama-3.1-8b-instant",
        "name": "Llama 3.1 8B",
        "description": "Fastest to first word. The default for calls.",
        "tag": "Instant",
        "good_for": "voice",
    },
    {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "description": "Quick and capable for everyday answers.",
        "tag": "Fast",
        "good_for": "both",
    },
    {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B",
        "description": "Stronger reasoning for detailed questions.",
        "tag": "Versatile",
        "good_for": "chat",
    },
    {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "description": "The most capable, and the slowest.",
        "tag": "Premium",
        "good_for": "chat",
    },
    {
        "id": "qwen/qwen3.6-27b",
        "name": "Qwen 3.6 27B",
        "description": "Strong multilingual and coding ability.",
        "tag": "Reasoning",
        "good_for": "both",
    },
]

GROQ_MODEL_IDS: frozenset[str] = frozenset(m["id"] for m in GROQ_MODELS)
