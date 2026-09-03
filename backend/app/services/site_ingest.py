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
    # Remove common banner/popup noise that pollutes the source
    for tag in soup.find_all(True):
        cls = " ".join(tag.get("class", [])).lower() if tag.get("class") else ""
        tid = (tag.get("id") or "").lower()
        hay = f"{cls} {tid}"
        if any(k in hay for k in ("cookie", "consent", "popup", "modal", "newsletter", "subscribe", "banner", "toast", "gdpr")):
            tag.decompose()
        elif tag.name in ("aside",):
            # keep aside only if it looks like main content
            if len(tag.get_text(strip=True).split()) < 40:
                tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text(separator="\n", strip=True)
    # collapse blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Drop single-line banner remnants
    lines = []
    for ln in text.split("\n"):
        s = ln.strip()
        if not s:
            lines.append("")
            continue
        low = s.lower()
        if low in ("accept all", "accept", "subscribe", "newsletter", "sign up", "cookies", "privacy policy"):
            continue
        if re.fullmatch(r"(accept|subscribe|follow us|share|tweet|like)[\s!]*", low):
            continue
        lines.append(s)
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    # Sentence-boundary truncation rather than mid-word cut
    if len(text) > 20000:
        cut = text[:20000]
        last_dot = cut.rfind(".")
        if last_dot > 15000:
            cut = cut[: last_dot + 1]
        return cut
    return text


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
    raw = (t.get_text(strip=True) if t else "")[:120]
    # Many sites use generic "Home" — try og:title or h1 as fallback
    if raw.strip().lower() in ("home", "homepage", "welcome", ""):
        og = soup.find("meta", property="og:title")
        if og and og.get("content"):
            return og["content"].strip()[:120]
        h1 = soup.find("h1")
        if h1 and h1.get_text(strip=True):
            return h1.get_text(strip=True)[:120]
    return raw


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


def _has_price_signal(text: str) -> bool:
    return bool(re.search(r"(₹|\$|€|£|INR|USD|price|pricing|plan|tier|per month|/mo|rs\.? |rupees|fee|cost)", text, re.I))


def _has_contact_signal(text: str) -> bool:
    return bool(re.search(r"(@|phone|tel:|contact|email|\+91|\+1 |address|location)", text, re.I))


def _truncate_safe(text: str, limit: int) -> str:
    """Truncate at last paragraph/bullet/sentence boundary before limit, never mid-word/bullet."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    # Prefer paragraph boundary, then bullet, then sentence
    for marker in ("\n\n", "\n- ", "\n• ", ". ", ".\n"):
        idx = cut.rfind(marker)
        if idx > limit * 0.6:  # only if not too short
            return cut[: idx + len(marker)].rstrip()
    # Fallback: last space
    last_space = cut.rfind(" ")
    if last_space > limit * 0.7:
        return cut[:last_space].rstrip() + " …"
    return cut.rstrip() + " …"


def _extract_bullet_summary(uniq: List[dict], max_chars: int = 7000) -> str:
    """Build compact bullet-point knowledge base from pages, preserving all sections span."""
    if not uniq:
        return "Core business details and FAQs as provided by owner."
    bullets = []
    for p in uniq[:20]:
        title = p["title"].strip()
        text = p["text"].strip()
        # Clean into sentences and pick informative ones
        sentences = re.split(r"(?<=[.!?])\s+", text)
        # Take first 2-3 meaningful sentences per page (avoid cookie/nav leftovers already cleaned)
        kept = []
        for s in sentences:
            s = s.strip().replace("\n", " ")
            if len(s) < 20:
                continue
            if len(s.split()) < 4:
                continue
            kept.append(s)
            if len(kept) >= 3:
                break
        if not kept:
            # Fallback: first 250 chars at sentence boundary
            snip = text[:280].strip()
            if "." in snip:
                snip = snip.rsplit(".", 1)[0] + "."
            kept = [snip]
        # Format as bullets grouped by page title
        for sent in kept:
            bullets.append(f"- [{title}] {sent}")
            if sum(len(b) for b in bullets) > max_chars:
                break
        if sum(len(b) for b in bullets) > max_chars:
            break
    out = "\n".join(bullets)
    # Ensure total within limit at bullet boundary
    if len(out) > max_chars:
        out = _truncate_safe(out, max_chars)
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

    # Bullet-point knowledge — compact but complete, never mid-bullet cut
    site_summary = _extract_bullet_summary(uniq, max_chars=7000)

    voice_body = f"""You are {agent_name}, the voice assistant for {biz}. Your primary goal is to {goal}.

ROLE & PERSONALITY
- You are a real human-sounding assistant speaking on a live phone call.
- Tone: {tone}, calm, attentive, and genuinely helpful.
- Speak naturally with contractions (I'll, we've, you're). Never sound like a robotic script.

HOW YOU SPEAK (CRITICAL FOR LIVE AUDIO)
- Keep every reply to 1 or 2 short, conversational sentences (under 30 words per turn).
- When you SPEAK, never output markdown, asterisks, bullet lists, emojis, URLs, or tables — speak naturally.
- Say numbers, prices, and times as spoken words (for example: "twenty-five hundred rupees", "four-thirty PM", "March fifth").
- In Hindi/Hinglish conversations, use polite 'aap' and natural phrasing.

TURN-TAKING & CONVERSATIONAL FLOW
- Listen carefully and answer the caller's specific question directly first.
- Ask at most ONE clarifying question at a time when needed. Never interrogate or ask multiple questions in a single turn.
- Acknowledge what the caller said naturally with brief openers when appropriate (like "Got it,", "Sure,", "I can help with that,").
- Never speak the caller's turn or invent answers on their behalf.

CORE BUSINESS KNOWLEDGE (use bullet points below as your source — speak them naturally, not as a list)
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
        "voice_script": _truncate_safe(voice_body.strip(), 9000),
        "chat_script": _truncate_safe(chat_body.strip(), 13000),
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

        # Full multi-page content extraction — rank longer pages first so pricing/FAQ not evicted by nav-heavy homepage
        uniq_sorted = sorted(uniq, key=lambda p: len(p.get("text", "")), reverse=True)
        site_text = "\n\n".join([
            f"=== PAGE: {p['title']} ({p.get('url', '')}) ===\n{p['text'][:1500].strip()}"
            for p in uniq_sorted[:20]
        ])[:18000]
        # Truncate at sentence boundary
        if len(site_text) == 18000:
            last_dot = site_text.rfind(".")
            if last_dot > 15000:
                site_text = site_text[: last_dot + 1]

        system_instruction = (
            "You are an expert Voice AI and Conversational Prompt Engineer. "
            "Your objective is to create a 100% self-contained, highly detailed, and accurate Voice System Prompt "
            "and Chat System Prompt based STRICTLY and ONLY on the provided website content or documents. "
            "STRICT GROUNDING & ZERO HALLUCINATION: Include only facts, services, products, pricing, and contact info "
            "present in the source content. Never invent, assume, or borrow features that are not in the provided text. "
            "If a section has no source evidence, OMIT the entire section — do not write '[NO DATA]' and do not invent a placeholder."
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
   - When SPEAKING, use 1 to 2 short conversational sentences per turn (under 30 words), no markdown/bullets in spoken turns.
   - In CORE BUSINESS KNOWLEDGE, PRODUCTS & SERVICES, PRICING, CONTACT, FAQS sections, USE bullet points (-) to list every detail completely — this is your knowledge base, not spoken output. Be thorough: include every product/feature/fact from source as a bullet.
   - Write all numbers, currency, percentages, and phone numbers in full spoken words (e.g. 'under one second', 'ninety-nine point nine percent', 'fifty thousand rupees', 'twenty-four seven', 'plus nine one nine zero five six four six zero nine zero zero').
   - Use natural transitions ('Got it,', 'Sure,', 'I can help with that,').

STRUCTURE FOR `voice_script` (keep it detailed but compact — bullet lists, no essay):
Organize with clear uppercase headers and double line breaks. OMIT any section that has no source — do not invent pricing or contact to fill it. Keep total under ~9000 chars but COVER EVERY FACT as bullets — never cut mid-bullet.

ROLE & IDENTITY:
State exact assistant name '{agent_name}', business name '{biz}', role, and primary objective.

SPEAKING STYLE:
Brief guidelines on conversational tone and spoken phonetics (1-2 sentences when speaking).

PRODUCTS & SERVICES:
List EVERY product, service, and feature explicitly found in the source as bullet points (- ). For each, 1 concise bullet explaining what it does and key capability. No paragraph dumps.

PRICING & PLANS:
Include pricing ONLY if source contains a price (₹, $, INR, plan, tier, fee) — each tier as a bullet. If none, OMIT this header entirely.

CONTACT & SUPPORT:
Include phone numbers, emails, locations ONLY if present — each as a bullet. If none, OMIT.

COMMON FAQS & POLICIES:
Provide answers ONLY to questions found in the text — each as a bullet (- Q: ... / A: ...).

UNCERTAINTY & CLOSING:
If a caller asks about something not in provided knowledge, politely state you will check or have team follow up. Close warmly.

Respond strictly with valid JSON only:
{{
  "voice_script": "...",
  "chat_script": "...",
  "greeting": "..."
}}"""

        content = ""
        import json as _json

        if mistral_key:
            # Use large by default (far better grounding than small — small invents pricing). Allow env pin.
            mistral_model = (getattr(_s, "MISTRAL_MODEL", "") or "").strip() or "mistral-large-latest"
            async with httpx.AsyncClient(timeout=45) as client:
                r = await client.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {mistral_key}", "Content-Type": "application/json"},
                    json={
                        "model": mistral_model,
                        "messages": [
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.15,
                        "max_tokens": 4200,
                    },
                )
                # If large is not enabled on this key, fall back to small rather than failing preview
                if r.status_code == 404 and mistral_model != "mistral-small-latest":
                    logger.warning("Mistral model %s not found, falling back to small", mistral_model)
                    r = await client.post(
                        "https://api.mistral.ai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {mistral_key}", "Content-Type": "application/json"},
                        json={
                            "model": "mistral-small-latest",
                            "messages": [
                                {"role": "system", "content": system_instruction},
                                {"role": "user", "content": user_prompt}
                            ],
                            "temperature": 0.15,
                            "max_tokens": 3800,
                        },
                    )
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
        elif groq_key:
            import groq
            client = groq.Groq(api_key=groq_key)
            # Prefer 120b for prompt quality when available; otherwise use configured model
            model_name = getattr(_s, "GROQ_MODEL", "openai/gpt-oss-20b")
            # If default fast 20b is set, upgrade to 120b for one-off prompt synthesis — quality matters more than speed here
            if model_name == "openai/gpt-oss-20b":
                model_name = "openai/gpt-oss-120b"
            try:
                resp = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": user_prompt}
                    ],
                    temperature=0.15,
                    max_tokens=4200,
                )
            except Exception as e:
                # Fallback to fast model if premium not enabled
                if "120b" in model_name:
                    logger.warning("Groq 120b unavailable (%s), falling back to 20b", e)
                    resp = client.chat.completions.create(
                        model="openai/gpt-oss-20b",
                        messages=[
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": user_prompt}
                        ],
                        temperature=0.15,
                        max_tokens=3800,
                    )
                else:
                    raise
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

        # Grounding gate: if LLM hallucinated pricing/contact where source has none, strip that section
        def _strip_hallucinated(prompt_text: str, source_text: str) -> str:
            if not prompt_text:
                return prompt_text
            low_source = source_text.lower()
            has_price = _has_price_signal(low_source)
            has_contact = _has_contact_signal(low_source)
            out = prompt_text
            # If source had no price signal but prompt contains a pricing header with invented numbers, drop it
            if not has_price:
                # remove PRICING & PLANS block until next uppercase header or end
                out = re.sub(r"PRICING & PLANS:.*?(?=\n[A-Z &]+:|\Z)", "", out, flags=re.S | re.I)
                # also strip bare invented rupee patterns that LLM loves to hallucinate
                if re.search(r"₹\s*\d|rs\.?\s*\d+|inr\s*\d+", out, re.I) and not re.search(r"₹|inr|rs\.?\s*\d", low_source, re.I):
                    out = re.sub(r".*?(₹\s*\d+|rs\.?\s*\d+|inr\s*\d+).*?\n", "", out, flags=re.I)
            if not has_contact and re.search(r"CONTACT & SUPPORT:", out, re.I):
                # keep header only if source actually had contact
                if not has_contact:
                    out = re.sub(r"CONTACT & SUPPORT:.*?(?=\n[A-Z &]+:|\Z)", "CONTACT & SUPPORT:\nContact details will be provided by the business on request.\n\n", out, flags=re.S | re.I)
            # Strip markdown that would be read aloud in voice
            if "**" in out or "##" in out:
                out = re.sub(r"\*\*(.*?)\*\*", r"\1", out)
                out = re.sub(r"^#{1,6}\s*", "", out, flags=re.M)
            # Ensure agent name present
            if agent_name.lower() not in out.lower()[:800]:
                out = f"You are {agent_name}, assistant for {biz}.\n\n" + out
            return out.strip()

        vs_checked = _strip_hallucinated(vs, site_text)
        cs_checked = _strip_hallucinated(cs, site_text)

        # Length gate + grounding gate — 80 char threshold replaced with 120 + price/contact check
        def _pick(generated: str, fallback_text: str) -> str:
            if len(generated.strip()) < 120:
                return fallback_text
            # If generated is <60% alphanumeric (likely garbage/bullet dump), fallback
            alnum_ratio = sum(c.isalnum() for c in generated) / max(len(generated), 1)
            if alnum_ratio < 0.35:
                return fallback_text
            return generated

        return {
            "voice_script": _truncate_safe(_pick(vs_checked, fallback["voice_script"]), 9000),
            "chat_script": _truncate_safe(_pick(cs_checked, fallback["chat_script"]), 13000),
            "greeting": (gr if len(gr) > 10 else fallback["greeting"])[:300],
        }
    except Exception as e:
        logger.warning("Prompt LLM synthesis failed, using rule-based builder: %s", e)
        return build_prompt_from_site(pages, answers)
