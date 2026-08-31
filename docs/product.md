# Scribe — what it is, and how it is used

Written for someone who has never seen this before: what the product does, who
uses it, every screen, and what each one is for.

---

## In one sentence

**Scribe turns your documents into something you can talk to — and lets a
business turn that into an assistant its customers can call.**

## The two products

One engine, two products, chosen by a single question on first arrival.

| | **Personal** | **Business** |
|---|---|---|
| Who | Anyone with their own API keys | A business owner |
| What they do | Ask questions about *their own* documents | Build an assistant *other people* call |
| Main screen | Chat with a document sidebar | A console: agent, people, overview |
| Who else is involved | Nobody | Callers, who never sign up |

The engine underneath — retrieval, citations, chat, voice — is identical. Only
the surface and who is asking differ.

---

## The three kinds of people

### 1. Personal user

Brings their own Groq (and optionally Sarvam) API key. Uploads documents. Asks
questions by typing or by talking. Every answer cites the exact page it came
from.

**Never signs up.** Their workspace *is* their keys: the same keys always reach
the same documents, so there is nothing to register and no password to lose.

### 2. Business owner

Also arrives with their own keys, but answers "Business" to the opening
question. They do not get a document library — they get a **console** where
they write an assistant's prompt, choose its voice and language, attach up to
three documents, test it, and deploy it.

Then they share links and read every conversation their assistant has.

**Optionally sets an email and password** so they can come back daily without
re-pasting an API key on a phone or a shared computer.

### 3. Caller

Someone the owner sent a link to. Taps it, talks to the assistant, done.

**No account, no signup, no app.** The link is their identity. Everything they
say is recorded under their name for the owner to read.

---

## Every screen

### Shared

| Screen | Path | What it does |
|---|---|---|
| Key entry | `/` | Paste your own Groq and Sarvam keys. The keys stay in your browser and are only spent on your own requests. |
| Mode question | `/setup` | Personal or Business — asked **once**. Business also asks the business name and category. |

### Personal

| Screen | Path | What it does |
|---|---|---|
| Chat | `/` | Upload documents, ask by text or voice. Answers carry `[1.1]` citations you can click to see the source. Voice is a real conversation you can interrupt. |

### Business console

Everything below sits in a dark-railed console — deliberately a different look
from the personal app, because it is a working surface rather than a reading
one.

| Screen | Path | What it does |
|---|---|---|
| **Overview** | `/dashboard` | Conversation counts, this week, voice calls, active people. Below that: **what people asked**, newest first — the clearest signal of what to add to your documents next. Then recent conversations. |
| **Assistant** | `/agent` | The whole agent: its name, its prompt, a greeting, voice (10 options, each previewable), language (auto-detect or one of 10 Indian languages), up to 3 documents, and whether voice answers from those documents. Plus **Deploy**, and a **Test** panel for both voice and chat. |
| **People** | `/links` | Create a share link per person. Copy it, rotate it, revoke it, block them, or delete them. See every conversation each person had, with the full transcript. Search, filter, and paging. |
| **Account** | `/settings` | Your Groq, Sarvam, and custom-model keys — encrypted, never shown back. Your model choice. And an email plus password so you can sign in without your keys. |
| **Sign in** | `/signin` | Email and password, for owners who set them. |

### Caller

| Screen | Path | What it does |
|---|---|---|
| Call | `/t/<token>` | Opens straight into a call: an orb, a timer, mute, end. Nothing else — no sidebar, no settings, no documents. |

---

## How each person uses it, start to finish

### A personal user

1. Open Scribe, paste a Groq key (and a Sarvam key for voice)
2. Choose **For myself**
3. Upload a PDF, notes, a spreadsheet
4. Ask questions by typing, or press the mic and talk
5. Click any `[1.1]` to see exactly which passage the answer came from

### A business owner

1. Open Scribe, paste keys, choose **For my business**
2. Name the business, pick a category
3. **Account** → paste the Groq and Sarvam keys the assistant will spend
4. **Assistant** → name it, write what it should say, pick a voice and
   language, optionally attach up to 3 documents
5. **Test** → call it. Hear the real voice, the real greeting, the real answers
6. **Deploy** — until this, links do not connect
7. **People** → create a link for someone, copy it, send it on WhatsApp
8. Come back tomorrow: **Overview** shows what people asked

### A caller

1. Tap the link
2. Allow the microphone
3. Talk
4. Same link works again, any time

---

## Features, plainly

**Answers you can check.** Every claim carries a citation pointing at the exact
document and passage. The server decides which citations are valid, so the
model cannot invent a source.

**An assistant that disagrees.** It corrects a wrong premise instead of
agreeing, holds its position under pushback when it is right, and never opens
with flattery. This is a deliberate product decision: agreement that is not
earned makes every other assessment worthless.

**Real voice, not a voice interface.** You can interrupt mid-sentence and it
stops and listens. The orb reacts to actual audio. Latency is treated as the
design constraint throughout.

**Ten Indian languages** for speech in and out, with auto-detect, plus a voice
per agent with previews before you commit.

**Links instead of accounts.** A caller holds a link and nothing else. First
device to open it claims it, so a forwarded copy is refused. Revoke, block, set
a PIN, or cap daily use.

**Every conversation, attributed.** Not just that someone called — what they
asked, and what the assistant said back.

**Your keys, your quota.** Everyone brings their own. Owner keys are encrypted
at rest and never shown back to the browser.

---

## What it deliberately does not do

- **No open discovery without limits.** The public directory (`/directory`) is intentionally a *preview* (search + 3-card teaser on `/`) that funnels to invite links, not a marketplace. Direct links (`/t/<token>`) remain the primary, private entry — directory adds discovery without exposing tenant ids.
- **More than three documents per business agent.** These are an assistant's
  working knowledge — an FAQ, a price list, a policy sheet. A high cap invites
  dumping a drive in and getting vague answers, which reads as the assistant
  being bad.
- **A general-purpose chatbot.** With no documents and no prompt, this is worse
  than the free alternatives. The point is grounding.
- **Phone numbers.** Calls travel over the internet by link. Real telephony
  costs money per minute and can be added when a customer asks for it.
