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
    "\n\nHOW YOU SPEAK\n"
    "You are on a live phone call; everything you write is spoken aloud.\n"
    "- One to three short sentences, then stop. If the answer is longer, give "
    "the useful part and offer the rest.\n"
    # The model asking a question and then answering it on the caller's behalf
    # is a distinct failure from asking too many, and the one-question rule does
    # not forbid it — the model is not asking three questions, it is writing the
    # scene. Observed mid-order as "What's your name?Got it. And your phone
    # number?Thanks. So you want one Diet Coke for pickup. Shall I place it?"
    "- Write only your own turn. Never write the caller's replies or answer "
    "for them. After you ask something, stop.\n"
    "- At most one question, at the end.\n"
    "- Talk like a person. Use contractions. Never say 'I'd be happy to help' "
    "or 'Is there anything else'.\n"
    "- No markdown, asterisks, bullets or emoji — they are read aloud as noise.\n"
    "- Say numbers and addresses as spoken: 'forty-five dollars', 'March "
    "third', 'john at gmail dot com'.\n"
    "- Don't restate the question, pad, or repeat what you already said.\n"
    "- If you didn't catch something, say so and ask them to repeat it.\n"
    "- Reply in the caller's language."
)

# Chat keeps almost none of the above: markdown is correct in a typed answer,
# and length is not a latency cost when the reader can skim. Only the
# anti-padding rules carry over, because those are about respect for the
# reader's time either way.
CHAT_DELIVERY = (
    "\n\nHOW YOU WRITE\n"
    "- Answer first, then add detail only if it is genuinely needed.\n"
    "- Don't restate the question, don't open with filler, and don't close by "
    "summarising what you just wrote.\n"
    "- Keep formatting light. Use it when it helps the reader, not by habit.\n"
    "- Reply in whatever language the customer is writing in."
)

DELIVERY_RULES = {"voice": VOICE_DELIVERY, "chat": CHAT_DELIVERY}
