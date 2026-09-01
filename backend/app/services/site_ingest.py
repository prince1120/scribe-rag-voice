"""Site → agent auto-create. Small modular service (<80 lines core).

Fetches a site's main text (homepage + up to 4 linked pages), chunks via same
pipeline as documents, and stores as docs for the agent. Reuses existing
ingestion (no new infra) — each page becomes a DocumentRecord with source_url.
"""
import logging
import re
from typing import List, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


MAX_PAGES = 30
MAX_BYTES = 500_000
TIMEOUT = 8.0
ALLOWED_SCHEMES = {"https", "http"}


def _clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text(separator="\n", strip=True)
    # collapse blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:20000]


async def _fetch_sitemap_urls(client: httpx.AsyncClient, base: str) -> List[str]:
    """Try /sitemap.xml, /sitemap_index.xml, robots.txt for locs. Returns same-origin URLs."""
    urls: List[str] = []
    candidates = [f"{base}/sitemap.xml", f"{base}/sitemap_index.xml", f"{base}/sitemap-index.xml"]
    # also try robots.txt
    try:
        rr = await client.get(f"{base}/robots.txt")
        if rr.status_code == 200:
            for line in rr.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    candidates.append(line.split(":", 1)[1].strip())
    except Exception:
        pass
    for cand in candidates:
        try:
            r = await client.get(cand)
            if r.status_code != 200 or not r.text.strip().startswith("<"):
                continue
            # naive xml loc extraction without extra deps
            for m in re.finditer(r"<loc>\s*(https?://[^<\s]+)\s*</loc>", r.text, re.I):
                u = m.group(1).strip()
                if base in u or urlparse(u).netloc == urlparse(base).netloc:
                    urls.append(u)
                if len(urls) >= MAX_PAGES:
                    break
        except Exception:
            continue
        if urls:
            break
    return urls[:MAX_PAGES]

async def fetch_site_pages(url: str) -> List[dict]:
    """Fetch homepage + sitemap/BFS up to MAX_PAGES (30) concurrently."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.netloc:
        raise ValueError("Enter a valid https:// URL")
    if parsed.hostname in {"localhost", "127.0.0.1"} or (parsed.hostname and parsed.hostname.startswith("192.168.")):
        raise ValueError("That address is not crawlable")
    base = f"{parsed.scheme}://{parsed.netloc}"
    start = url.strip()

    import asyncio

    async with httpx.AsyncClient(timeout=6.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; ScribeBot/1.0)"}) as client:
        # 1) Try sitemap
        sitemap_urls = await _fetch_sitemap_urls(client, base)
        queue: List[str] = sitemap_urls if sitemap_urls else [start]
        if start not in queue:
            queue.insert(0, start)

        # If sitemap was empty, discover links from start page first
        if len(queue) == 1:
            try:
                r0 = await client.get(start)
                if r0.status_code == 200:
                    soup = BeautifulSoup(r0.text, "html.parser")
                    for a in soup.find_all("a", href=True)[:40]:
                        nxt = urljoin(base, a["href"])
                        if urlparse(nxt).netloc == parsed.netloc and nxt not in queue:
                            queue.append(nxt)
            except Exception:
                pass

        target_urls = [
            u for u in queue[:MAX_PAGES]
            if not any(x in u.lower() for x in ("/login", "/cart", "/checkout", "mailto:", "tel:", ".jpg", ".png", ".pdf"))
        ]

        sem = asyncio.Semaphore(8)

        async def _fetch_one(href: str) -> Optional[dict]:
            async with sem:
                try:
                    r = await client.get(href)
                    if r.status_code == 200 and len(r.content) <= MAX_BYTES:
                        text = _clean_text(r.text)
                        if len(text.split()) >= 15:
                            return {"url": href, "title": _title(r.text) or href, "text": text}
                except Exception:
                    pass
                return None

        results = await asyncio.gather(*[_fetch_one(u) for u in target_urls])
        valid_pages = [p for p in results if p is not None]
        return _dedupe_pages(valid_pages)


def _title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    t = soup.find("title")
    return (t.get_text(strip=True) if t else "")[:120]


def _dedupe_pages(pages: List[dict]) -> List[dict]:
    seen_titles: set[str] = set()
    seen_text: set[str] = set()
    out: List[dict] = []
    for p in pages:
        title = (p.get("title") or "").strip().lower()
        text_head = (p.get("text") or "")[:400].strip().lower()
        if title and title in seen_titles:
            continue
        if text_head and text_head in seen_text:
            continue
        # also skip pages where text is >80% same as first page's hero
        if text_head:
            seen_text.add(text_head)
        if title:
            seen_titles.add(title)
        out.append(p)
    return out


def build_prompt_from_site(pages: List[dict], answers: Optional[dict] = None) -> dict:
    """Generate structured, voice-first system prompt and separate chat prompt from extracted content."""
    answers = answers or {}
    goal = (answers.get("goal") or "assist customers with inquiries and bookings warmly and accurately").strip()
    tone = (answers.get("tone") or "warm & friendly").strip()
    business = (answers.get("business") or "").strip()
    agent_name = (answers.get("name") or answers.get("agent_name") or "Assistant").strip()
    biz = business or (pages[0]["title"] if pages else "this business")[:60]
    uniq = _dedupe_pages(pages)
    
    # Extract structured key facts for prompt (without cutting words in half)
    if uniq:
        parts = []
        for p in uniq[:15]:
            snippet = p["text"][:800].strip().replace("\n", " ")
            # Ensure snippet finishes at a clean sentence boundary
            if "." in snippet:
                snippet = snippet.rsplit(".", 1)[0] + "."
            if len(snippet) > 20:
                parts.append(f"[{p['title']}]: {snippet}")
        site_summary = "\n\n".join(parts)
    else:
        site_summary = "Core business details and FAQs as provided by owner."

    voice_body = f"""You are {agent_name}, the voice assistant for {biz}. Your primary goal is to {goal}.

ROLE & PERSONALITY
- You are a real human-sounding assistant speaking on a live phone call.
- Tone: {tone}, calm, attentive, and genuinely helpful.
- Speak naturally with contractions (I'll, we've, you're). Never sound like a robotic script or corporate IVR.

HOW YOU SPEAK (CRITICAL FOR LIVE AUDIO)
- Keep every reply to 1 or 2 short, conversational sentences (under 30 words per turn).
- NEVER output markdown, asterisks, bullet lists, emojis, URLs, or tables.
- Say numbers, prices, and times as spoken words (for example: "twenty-five hundred rupees", "four-thirty PM", "March fifth").
- In Hindi/Hinglish conversations, use polite 'aap' and natural phrasing.

TURN-TAKING & CONVERSATIONAL FLOW
- Listen carefully and answer the caller's specific question directly first.
- Ask at most ONE clarifying question at a time when needed. Never interrogate or ask multiple questions in a single turn.
- Acknowledge what the caller said naturally with brief openers when appropriate (like "Got it,", "Sure,", "I can help with that,").
- Never speak the caller's turn or invent answers on their behalf.

CORE BUSINESS KNOWLEDGE
{site_summary}

KNOWLEDGE BASE FALLBACK & UNCERTAINTY
- Answer from your business knowledge above first.
- If the caller asks for details not covered above, never invent facts. Briefly mention you're checking (e.g. "Let me check that for you..."), then continue smoothly with the verified answer from fallback excerpts.

CLOSINGS & GOODBYES
- When the caller indicates they are done (e.g., "thanks that's all", "bye", "shukriya", "ho gaya"), respond with a warm one-sentence closing and conclude the call gracefully."""

    chat_body = f"""You are {agent_name}, the customer assistant for {biz}. Your goal is to {goal}.

TONE & STYLE
- Tone: {tone}, professional, concise, and structured.
- Answer the customer's direct question in the very first sentence.
- Use clean Markdown formatting (bullet points, bold highlights) for readability.
- When referencing specific policies, fees, or requirements, provide clear, structured breakdowns.

BUSINESS KNOWLEDGE
{site_summary}

KNOWLEDGE BASE & CITATIONS
- Answer from the business facts above first.
- For in-depth policies, terms, or historical documents, supplement with provided knowledge base excerpts and cite relevant sources accurately."""

    greeting = f"Hello! This is {agent_name} from {biz}. How can I help you today?"

    return {
        "voice_script": voice_body.strip()[:8000],
        "chat_script": chat_body.strip()[:12000],
        "greeting": greeting[:300],
    }


async def build_prompt_with_mistral(pages: List[dict], answers: Optional[dict] = None) -> dict:
    """Synthesize custom Voice & Chat prompts from crawled pages using Mistral or Groq LLM."""
    try:
        from app.config import settings as _s
        mistral_key = (_s.MISTRAL_API_KEY or "").strip()
        groq_key = (_s.GROQ_API_KEY or "").strip()

        if not mistral_key and not groq_key:
            return build_prompt_from_site(pages, answers)

        answers = answers or {}
        agent_name = (answers.get("name") or answers.get("agent_name") or "Assistant").strip()
        biz = (answers.get("business") or (pages[0]["title"] if pages else "this business"))[:80]
        goal = (answers.get("goal") or "assist customers warmly and accurately, answer FAQs, and explain our platform/services").strip()
        tone = (answers.get("tone") or "warm, professional & friendly").strip()
        uniq = _dedupe_pages(pages)

        # Full multi-page content extraction from all crawled subpages
        site_text = "\n\n".join([
            f"=== PAGE: {p['title']} ({p.get('url', '')}) ===\n{p['text'][:1500].strip()}"
            for p in uniq[:20]
        ])[:18000]

        system_instruction = (
            "You are an expert Voice AI and Conversational Prompt Engineer. "
            "Your objective is to create a 100% self-contained, highly detailed, and accurate Voice System Prompt "
            "and Chat System Prompt based STRICTLY and ONLY on the provided website content or documents. "
            "STRICT GROUNDING & ZERO HALLUCINATION: Include only facts, services, products, pricing, and contact info "
            "present in the source content. Never invent, assume, or borrow features that are not in the provided text."
        )

        user_prompt = f"""Assistant Name: '{agent_name}' (CRITICAL: Name the assistant '{agent_name}'. Do NOT replace '{agent_name}' with any other mascot or extracted name.)
Business / Company Name: '{biz}'
Goal: {goal}
Tone: {tone}

All Extracted Content from Website & Subpages (STRICT SOURCE OF TRUTH):
{site_text}

TASK:
Write an accurate, comprehensive, and self-contained Voice System Prompt (`voice_script`) and Chat Prompt (`chat_script`) derived 100% from the extracted content above.

CRITICAL INSTRUCTIONS:
1. STRICT GROUNDING: Include ONLY the products, services, features, pricing, contact details, and FAQs that actually exist in the extracted text above. Do NOT hallucinate or assume unmentioned features.
2. SPOKEN AUDIO RULES FOR `voice_script`:
   - 1 to 2 short conversational sentences per turn (under 30 words).
   - ZERO markdown, ZERO bullets, ZERO asterisks, ZERO tables.
   - Write all numbers, currency, percentages, and phone numbers in full spoken words (e.g. 'under one second', 'ninety-nine point nine percent', 'fifty thousand rupees', 'twenty-four seven', 'plus nine one nine zero five six four six zero nine zero zero').
   - Use natural transitions ('Got it,', 'Sure,', 'I can help with that,').

STRUCTURE FOR `voice_script`:
Organize with clear uppercase headers and double line breaks:

ROLE & IDENTITY:
State exact assistant name '{agent_name}', business name '{biz}', role, and primary objective.

SPEAKING STYLE:
Brief guidelines on conversational tone and spoken phonetics.

PRODUCTS & SERVICES:
Detail every product, service, and feature explicitly found in the source text. Explain what each one does and how it works based on the text.

PRICING & PLANS:
Include all pricing models, tiers, fees, or demo options mentioned in the source text.

CONTACT & SUPPORT:
Include all official phone numbers, email addresses, response times, and locations extracted from the text.

COMMON FAQS & POLICIES:
Provide answers to common customer questions, workflows, compliance, and policies found in the text.

UNCERTAINTY & CLOSING:
If a caller asks about something not in the provided business knowledge, politely state you will check or have the team follow up. Close conversations warmly.

Respond strictly with valid JSON only:
{{
  "voice_script": "...",
  "chat_script": "...",
  "greeting": "..."
}}"""

        content = ""
        import json as _json

        if mistral_key:
            async with httpx.AsyncClient(timeout=35) as client:
                r = await client.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {mistral_key}", "Content-Type": "application/json"},
                    json={
                        "model": "mistral-small-latest",
                        "messages": [
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.2,
                        "max_tokens": 3800,
                    },
                )
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
        elif groq_key:
            import groq
            client = groq.Groq(api_key=groq_key)
            model_name = getattr(_s, "GROQ_MODEL", "openai/gpt-oss-20b")
            resp = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2,
                max_tokens=3800,
            )
            content = resp.choices[0].message.content or ""

        try:
            data = _json.loads(content)
        except Exception:
            m = re.search(r"\{.*\}", content, re.S)
            data = _json.loads(m.group(0)) if m else {}

        vs_raw = data.get("voice_script") or data.get("voiceScript") or ""
        if isinstance(vs_raw, dict):
            vs_raw = "\n".join(f"{k}: {v}" for k, v in vs_raw.items())
        vs = str(vs_raw).strip()

        cs_raw = data.get("chat_script") or data.get("chatScript") or ""
        if isinstance(cs_raw, dict):
            cs_raw = "\n".join(f"{k}: {v}" for k, v in cs_raw.items())
        cs = str(cs_raw).strip()

        gr = str(data.get("greeting") or "").strip()

        fallback = build_prompt_from_site(pages, answers)
        return {
            "voice_script": (vs if len(vs) > 80 else fallback["voice_script"])[:8000],
            "chat_script": (cs if len(cs) > 80 else fallback["chat_script"])[:12000],
            "greeting": (gr if len(gr) > 10 else fallback["greeting"])[:300],
        }
    except Exception as e:
        logger.warning("Prompt LLM synthesis failed, using rule-based builder: %s", e)
        return build_prompt_from_site(pages, answers)
