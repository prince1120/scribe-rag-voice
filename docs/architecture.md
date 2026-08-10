# Architecture

## Two products, one engine

Scribe is a retrieval and voice stack serving two different products, chosen by
a question asked once on first arrival.

**Personal** — upload your documents, ask about them by text or voice. Answers
cite the exact chunk they came from.

**Business** — the same engine, configured by an owner into an assistant *other
people* call. The owner writes a prompt, picks a voice, optionally attaches up
to three documents, and shares links. Every conversation is attributed to the
person who had it.

The retrieval, generation, and voice pipelines are identical. Only the surface
and the identity model differ.

## Layers

Requests move through three layers, and each has exactly one job. If a decision
is being made in a route, or SQL is being written in a service, it is in the
wrong place.

```
app/api/*_routes.py       HTTP: parse, delegate, map errors to status codes
        ↓
app/services/*.py         Rules and decisions. No SQL, no HTTP
        ↓
app/repositories/*.py     SQL. No rules
```

The payoff is testability: `tests/test_owner_service.py` verifies sixteen
business rules in under a second with no database, because none of them need
one. A test in that file that requires SQL is a signal a rule has leaked
downward.

## The stores, and what each holds

A document exists in three places at once. They must be kept consistent, which
is what `services/cleanup.py` is for.

| Store | Holds | If it disappears |
|---|---|---|
| Supabase Postgres | Metadata, conversations, owners, contacts | The document vanishes from the UI |
| Supabase Storage (or disk) | The original uploaded file | Download, editing, and image questions break |
| Qdrant | Chunk text and vectors | Chat stops finding it |

Uploads are session-scoped and the file may live on a disk a redeploy wipes,
but the row and the vectors survive. Left alone, the app lists documents whose
file is gone: chat still answers from indexed text, so it *looks* healthy and
only breaks when touched. Two idempotent sweeps prevent that — orphans (file
already missing) and expiry (past the TTL). Deletion order is always vectors,
file, then row, because the row is the only record the document exists.

## Voice

The voice worker is a **separate long-lived process**, not a request handler.
It registers with LiveKit and is dispatched rooms as jobs.

```
Browser ──WebRTC──> LiveKit ──dispatch──> voice worker
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         Sarvam STT       LLM (Groq/…)   Sarvam TTS
                                              │
                                              ▼
                                    /voice/retrieve (this API)
```

Latency is the design constraint. Everything in the path between someone
finishing a sentence and the assistant starting to speak is treated as a cost:

- Turn-taking delay is the largest single term and is felt on **every** turn
- The RAG lookup reuses a keep-alive connection pool; opening a new HTTPS
  connection per turn put a full handshake inside that pause
- Voice over-fetches fewer rerank candidates than chat, because chat can hide
  the cost behind a streaming cursor and voice cannot

Markdown is stripped in code at `tts_node`, not requested in the prompt.
Instruction-following degrades on small fast models, and fast models are
exactly what voice wants — so "do not use markdown" is enforced rather than
asked for.

## Prompts

For a **business agent**, the owner's prompt is passed through **verbatim**.
Layering our own persona and style scaffolding on top would mean an owner tunes
a prompt and hears something else, which makes the editor untrustworthy.

Only two things are appended:

1. **Identity** — the agent's name and business, so a prompt that forgets to
   mention either still produces a coherent assistant.
2. **The current date and time**, recomputed per turn. It cannot be written in
   advance: a date typed into a prompt is stale the next day, and without it
   the model answers "what is today" from training data, confidently.

Personal workspaces keep the persona system they already use.

## Citation integrity

The server computes which citation ids are valid and passes that allowlist into
the prompt, so the model **cannot** invent a source. The UI then drops any
marker that does not resolve, rather than rendering a dead `[1.5]`.

The source list under an answer shows only the citations actually referenced.
Retrieval returns top-k chunks but a model may use two of five; listing all
five would imply evidence the answer never leaned on.

## Frontend

`app/page.tsx` is a large single component and a known liability. It is being
decomposed surface by surface, not rewritten — each swap is checked
feature-by-feature against the old markup first.

That check is not optional. The first attempt at replacing the message list
would have silently dropped image attachments, the copy button, filtered
sources, and latency metrics. Parity check first, swap second.

Design tokens live in `app/styles/design-system.css`. No component should
contain a raw value for spacing, motion, or elevation.
