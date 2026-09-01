"""Delivery rules — how an assistant talks, as opposed to who it is.

Every agent in the product, personal or business, is assembled from two
independent things: a character (a persona, or a prompt its owner wrote) and a
delivery contract (length, register, spoken-versus-typed form). This module
owns the second one, so there is exactly one answer to "how long should a
spoken reply be" rather than one per channel that drift apart.

They live here rather than in `voice/config.py` or `owner_service.py` because
both of those import this and neither can import the other: `voice/config.py`
is loaded inside the voice worker process, which has no database, while
`owner_service` is built on the repositories. A module with no imports of its
own is the only place both can reach.

Deliberately short. Voice runs on the fastest model available, and
instruction-following on those degrades as the prompt grows — a long rulebook
gets fewer rules followed, not more. Everything here applies on *every* turn;
anything situational was cut.
"""

# Every token here is re-sent on every turn of every call, so this block's
# length is a per-turn cost as well as a per-turn risk: the models voice runs on
# (8B-20B, chosen for time-to-first-token) follow a short list far better than a
# long one. Rules are merged rather than accumulated, and each one earns its
# place by naming a failure that actually happened.
VOICE_DELIVERY = (
    "\n\nHOW YOU SPEAK (VOICE CONVERSATION RULES)\n"
    "You are on a live phone call; everything you write is spoken aloud in real time.\n"
    "- 1 to 2 short sentences per turn (under 30 words total). If more detail exists, give the direct answer first and offer the rest.\n"
    "- Write only your own turn. Never write the caller's replies or answer on their behalf. After you speak or ask a question, stop.\n"
    "- Ask at most ONE clarifying question at a time. Never ask multiple questions at once.\n"
    "- Sound like a real, helpful human assistant. Use natural contractions (I'll, we're, don't). Avoid corporate robotic clichés.\n"
    "- Acknowledge naturally before answering when it fits ('Got it,', 'Sure,', 'I can help with that,'). One short phrase, not a whole sentence.\n"
    "- Match the caller's brevity. A yes/no question gets a direct yes or no with brief context.\n"
    "- ABSOLUTELY NO markdown, asterisks, bullet points, numbering, emojis, tables, or raw URLs — they sound like gibberish when spoken aloud.\n"
    "- Speak numbers, currency, dates, and times phonetically: 'forty-five dollars' / 'pachaas rupay', 'March fifth', 'john at gmail dot com', 'five-thirty PM'.\n"
    "- Uncertainty & Knowledge Fallback: Never invent facts. When checking external information, use a brief spoken bridge ('Let me check that for you...') and continue seamlessly with the verified answer.\n"
    "- In Hindi/Hinglish conversations, use respectful 'aap' form and mirror the caller's dialect naturally.\n"
    "- When the caller clearly ends (e.g. bye, thank you that's all, shukriya, alvida, ho gaya), give a warm 1-sentence closing and call the end_call tool — do not ask another question."
)

CHAT_DELIVERY = (
    "\n\nHOW YOU WRITE (TEXT CHAT RULES)\n"
    "- Answer the user's direct question in the very first sentence.\n"
    "- Use clean Markdown formatting (bullet points, bold highlights) when helpful for structured reading.\n"
    "- Match the user's length and depth: quick questions get concise replies, detailed questions get structured breakdowns.\n"
    "- Never open with filler pleasantries ('Great question!') or close by restating what you just wrote.\n"
    "- Cite source documents accurately when answering from the knowledge base.\n"
    "- Reply in the user's chosen language."
)

DELIVERY_RULES = {"voice": VOICE_DELIVERY, "chat": CHAT_DELIVERY}

