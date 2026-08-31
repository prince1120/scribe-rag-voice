"""Agent prompt compiler — small, pure, testable.

Owner picks high-level blocks (duties, tone, greeting) → we compile to
a tight voice_script/chat_script that stays grounded, cites, and saves
tokens. Keeps the globs out of agent/page.tsx and owner_service.py.
"""

from typing import Optional

BASE_VOICE_RULES = (
    "Keep replies to 1–3 sentences, plain spoken language, no markdown or bullet lists. "
    "Say numbers and dates as spoken words."
)

def compile_voice_script(business: str, duties: str) -> str:
    return (
        f"You are {business}, answering live phone calls.\n\n"
        f"{duties}\n"
        f"Be warm, concise, and correct. If you don't know, say so and offer to take a message.\n"
        f"{BASE_VOICE_RULES}"
    )

def compile_chat_script(business: str, duties: str) -> str:
    return (
        f"You are {business}, answering customer questions in text chat.\n\n"
        f"{duties}\n"
        f"Answer first, then explain briefly. Use citations from the attached documents when you have them.\n"
        f"Keep openings short — no 'Great question!' — and never invent a source."
    )

def compile_greeting(business_name: Optional[str]) -> str:
    if business_name:
        return f"Hello! Thanks for calling {business_name}. How can I help you today?"
    return "Hello! Thanks for calling. How can I help you today?"
