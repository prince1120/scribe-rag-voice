# Quick Start

Get chat running in ~5 minutes, then optionally turn on voice. For *why* things are built the way they are, see [README.md](README.md) — this doc is just the steps.

## Prerequisites

1. **Python 3.11+**
2. **Node.js 18+**
3. **Docker Desktop** (easiest way to run Qdrant + Redis) — or use their cloud free tiers instead
4. **A Groq API key** — free, no credit card: https://console.groq.com

## 1. Get the repo ready

```powershell
cd "d:\work\New folder"
```
(Everything below assumes you're in the project root, wherever you cloned it — the scripts figure out their own location, no path editing needed.)

## 2. Configure the backend

```powershell
cd backend
copy .env.example .env
```
Open `backend/.env` and set at minimum:
```env
GROQ_API_KEY=your_key_here
```
Everything else has a sane default. (Voice and custom-model variables are optional — see [step 6](#6-optional-voice) and [step 7](#7-optional-bring-your-own-model).)

## 3. Start Qdrant + Redis

```powershell
cd ..
docker compose up -d qdrant redis
```
No Docker? Use free cloud tiers instead and point `.env` at them: [Qdrant Cloud](https://cloud.qdrant.io), or skip Redis entirely (the app falls back to in-memory conversation context automatically).

## 4. Start the backend

```powershell
.\start_backend.ps1
```
This creates a venv, installs dependencies, and runs the API on `http://localhost:8000` (docs at `/docs`). If `LIVEKIT_URL` is set in `.env`, the voice worker also starts automatically in the background — nothing else to run for that.

## 5. Start the frontend (new terminal)

```powershell
.\start_frontend.ps1
```
Opens on `http://localhost:3000`.

## 6. Use it

1. Upload a document (left panel) or paste text directly.
2. Ask a question in the chat box — answers stream in with clickable `[N.M]` citations back to the source.
3. Open **Settings** (gear icon) to change models, temperature, top-k, or add a custom model.

---

## 6. (Optional) Voice

1. Create a free project at https://cloud.livekit.io and grab its URL + API key + secret.
2. Create a free key at https://dashboard.sarvam.ai (used for speech-to-text and text-to-speech).
3. Add to `backend/.env`:
   ```env
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   SARVAM_API_KEY=...
   ```
4. Restart the backend. The voice worker starts automatically alongside it — no separate process to manage. Click the phone icon in the UI, then **Start conversation**.

If a call times out with "assistant isn't responding," check `backend/voice_worker.log` — most often it means one of the four variables above is missing or wrong.

## 7. (Optional) Bring your own model

Want to chat/talk with Mistral, OpenRouter, or any other OpenAI-compatible API instead of Groq?

1. Open **Settings → Active LLM Model**.
2. Click **"Add a model (any OpenAI-compatible API)"**.
3. Fill in:
   - **Name**: whatever you want to call it (e.g. `Mistral`)
   - **Base URL**: e.g. `https://api.mistral.ai/v1`
   - **API key**: your key for that provider
   - **Model id**: e.g. `ministral-3b-2512`
4. Click **Add** — it's now selected and used for *both* chat and voice. Nothing is saved to the server; the key lives only in your browser.

## 8. Try the demo-mode gate

Don't want to put your own Groq/Sarvam keys in `.env` at all? Skip step 2's `GROQ_API_KEY` and just open the frontend — it'll prompt you to paste your own keys and give you an isolated session, capped at 4 documents. This is the same flow a public visitor would see if you deployed this somewhere.

## Alternative: everything in Docker

```bash
docker compose up -d --build
```
Brings up Qdrant, Redis, the backend, the voice worker (as its own restart-supervised service), and the frontend together. Same `backend/.env` file is used.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError` on backend start | `cd backend; .\venv\Scripts\Activate; pip install -r requirements.txt --upgrade` |
| "Cannot connect to Qdrant" | `docker ps` to confirm it's running, or check `QDRANT_HOST` in `.env` |
| Groq "rate limit exceeded" | Free tier is rate-limited — wait a minute, or upgrade at console.groq.com |
| Voice: "could not establish signal connection" in the browser console | Network/IPv6 issue reaching LiveKit, not the app — see the Troubleshooting section in README.md |
| Voice: worker seems stuck/not responding | Check `backend/voice_worker.log`; confirm all 4 `LIVEKIT_*`/`SARVAM_API_KEY` vars are set |

## What's next

See [README.md](README.md) for the full architecture, how retrieval/reranking works, the multi-tenant demo-mode design, and the API reference.
