import os
import io
import base64
import groq
import openai
from typing import List, Dict, Any, Optional
import logging
from tenacity import retry, stop_after_attempt, wait_exponential
import tiktoken

try:
    from PIL import Image
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RAGPipeline:
    """Main RAG pipeline with Groq LLM."""
    
    def __init__(
        self,
        groq_api_key: str,
        model: str = "llama3-8b-8192",
        vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct",
    ):
        self.client = groq.Groq(api_key=groq_api_key)
        self.model = model
        self.vision_model = vision_model
        self.encoding = tiktoken.get_encoding("cl100k_base")

    def _client_for(
        self,
        groq_api_key: Optional[str],
        *,
        custom_base_url: Optional[str] = None,
        custom_api_key: Optional[str] = None,
    ):
        """Request-scoped LLM client.

        - custom_base_url set: any OpenAI-compatible endpoint the user
          configured themselves (Mistral, OpenRouter, a local vLLM server,
          ...) — never a server-side key, always what the caller supplied.
        - groq_api_key set (no custom_base_url): caller-supplied Groq key
          (demo mode).
        - neither: the server's own Groq client.

        Groq's SDK and `openai.OpenAI` expose the identical
        `.chat.completions.create(...)` surface (Groq's client is a fork of
        OpenAI's), so callers below don't need to branch on which one this
        returns.
        """
        if custom_base_url:
            return openai.OpenAI(api_key=custom_api_key or "", base_url=custom_base_url)
        if groq_api_key:
            return groq.Groq(api_key=groq_api_key)
        return self.client

    # ---- Context budgeting ----------------------------------------------

    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        if max_tokens <= 0:
            return ""
        tokens = self.encoding.encode(text)
        if len(tokens) <= max_tokens:
            return text
        return self.encoding.decode(tokens[:max_tokens]) + " …"

    def _build_context(
        self,
        context_chunks: List[Dict],
        max_context_tokens: int = 4500,
    ):
        """Pack retrieved chunks into a context string under a token budget.

        Returns (context_text, allowed_ids) so the caller can tell the LLM
        exactly which citation IDs are valid (prevents hallucinated [1.5] etc.).
        """
        parts: List[str] = []
        allowed_ids: List[str] = []
        used = 0
        for i, chunk in enumerate(context_chunks):
            payload = chunk.get("payload", chunk) or {}
            display = chunk.get("display_number") or str(i + 1)
            header = f"[Source {display}]"
            if payload.get("filename"):
                header += f" {payload['filename']}"
            if payload.get("page_number"):
                header += f" p.{payload['page_number']}"
            header += ":\n"

            content = payload.get("content", "") or ""
            header_tokens = len(self.encoding.encode(header))
            remaining = max_context_tokens - used - header_tokens - 4
            if remaining <= 60:
                # Not enough room for anything meaningful — stop here.
                break

            truncated = self._truncate_to_tokens(content, remaining)
            block = header + truncated
            parts.append(block)
            allowed_ids.append(display)
            used += len(self.encoding.encode(block)) + 4

        return "\n\n".join(parts), allowed_ids

    def _build_system_prompt(
        self, has_images: bool, has_text_context: bool,
        agent_prompt: Optional[str] = None,
    ) -> str:
        """Assemble the system prompt.

        When a business owner has written an agent prompt it leads, because it
        is theirs and everything else is scaffolding. The citation rules still
        follow it: those are not style, they are what keeps the model from
        inventing a source, and an owner cannot opt out of that.
        """
        # The owner's voice, first. Prefixed rather than merged so what they
        # wrote reaches the model unaltered — the same guarantee the voice path
        # gives, so one assistant does not answer differently by channel.
        lead = ""
        if agent_prompt and agent_prompt.strip():
            lead = agent_prompt.strip() + chr(10) + chr(10)

        base = (
            "LENGTH:\n"
            "- Match the question. Short Q -> short A. Detailed Q -> detailed A.\n"
            "- No preamble. Start with the answer.\n"
            "\n"
            "FORMATTING (markdown is rendered):\n"
            "- Use **bold** for key terms.\n"
            "- Use bullets / ## headings only when the answer needs structure.\n"
            "- Plain prose for short answers.\n"
            "\n"
            # Unearned agreement is an assistant's default failure mode: it is
            # the cheapest output available and it reads as helpful, so it goes
            # unnoticed. It also makes every other assessment worthless, since
            # the reader can no longer tell praise from judgement.
            "BEING USEFUL RATHER THAN AGREEABLE:\n"
            "- If the user's premise is wrong, say so directly and give the "
            "correct version. Do not bury the correction after a compliment.\n"
            "- If their approach has a real problem, name it and say what you "
            "would do instead.\n"
            "- If they push back and they are right, say so and change your "
            "answer. If they are still wrong, hold your position and explain "
            "why — insistence is not evidence.\n"
            "- Never open with 'Great question', 'Good catch', or similar. "
            "Answer instead.\n"
            "- Separate what the sources establish from what you are inferring, "
            "and label the inference as yours.\n"
        )

        if has_images and not has_text_context:
            return lead + (
                "You are a helpful AI assistant. The user has attached one or more "
                "images and is asking about them. Look carefully at the image(s) "
                "and answer based on what you see.\n\n"
                + base
                + "\nCITATIONS:\n"
                "- No document context is provided, so do not add [N] citations.\n"
                "- If asked about something not visible in the image(s), say so honestly.\n"
            )

        if has_images and has_text_context:
            return lead + (
                "You answer questions using the attached image(s) AND the provided "
                "document context. Combine both when relevant.\n\n"
                + base
                + "\nCITATIONS:\n"
                "- Each [Source X] in the context has a hierarchical id like 1.1, 1.2, 2.1.\n"
                "  The first number is the document, the second is the chunk within it.\n"
                "- For claims drawn from the document context, end the sentence/bullet "
                "with a marker in EXACTLY this form: [N.M].\n"
                "- For visual observations from the attached image(s), no citation needed.\n"
                "- FORBIDDEN: [Source 1.1], 'see source 2.1', bare '1.1' or '1'.\n"
                "\nGOOD example:\n"
                "- **Modular agents** replace the previous monolithic design. [1.1]\n"
                "- The chart shows revenue rising from Q1 to Q3.\n"
                "\nIf neither the image nor the documents contain the answer, say so honestly. "
                "Do not use outside knowledge.\n"
            )

        # Text-only path
        return lead + (
            "You answer questions about the user's documents using the provided context.\n\n"
            + base
            + "\nWHAT YOU CAN DO:\n"
            "- Summarize, paraphrase, and synthesize across the provided sources.\n"
            "- Answer broad questions like 'what is this about?', 'main topics', 'key points', "
            "'overview' by describing what the retrieved chunks cover.\n"
            "- Quote exact text when the user asks for it.\n"
            "- Reasonably infer obvious things from the context (e.g. if all chunks are about "
            "deep learning, the document is about deep learning).\n"
            "\nCITATIONS - MANDATORY:\n"
            "- Each [Source X] header has a hierarchical id like 1.1, 1.2, 2.1.\n"
            "  First number = document, second = chunk within it.\n"
            "- EVERY claim taken from the sources must carry a marker in EXACTLY "
            "this form: [N.M]\n"
            "  Examples of CORRECT form: [1.1]  [1.2]  [2.1]  or combined [1.1][2.1]\n"
            "- Cite per claim, not per sentence. When consecutive sentences come "
            "from the same source, one marker at the end of that passage is "
            "correct — repeating the same id on every line is noise and makes "
            "the answer harder to read.\n"
            "- FORBIDDEN: [Source 1.1], (Source 1.1), 'see source 1.1', bare '1.1', or no citation.\n"
            "- Use the EXACT N.M id from the [Source N.M] header in the context.\n"
            "- The N.M id is a CITATION MARKER, not a fact from the document. NEVER answer with "
            "the id itself (e.g. never say \"the identifier is 1.1\" or \"the number is 1.2\") — "
            "it is metadata about where the answer came from, not content.\n"
            "\nGOOD example:\n"
            "- The document covers **deep learning fundamentals** including neural network basics. [1.2]\n"
            "- Loss functions discussed include MSE, MAE, and Binary Cross-Entropy. [1.4]\n"
            "\nBAD example (do NOT do this):\n"
            "- The document covers deep learning fundamentals.   ← missing citation\n"
            "- The framework supports streaming. [1]              ← wrong format, must be N.M\n"
            "- The document's identifier is 1.1.                  ← citation marker mistaken for content\n"
            "\nIf the retrieved context does not actually contain an answer to the specific "
            "question asked, refuse — do NOT fill the gap by describing the source/citation "
            "system, guessing, or inventing a plausible-sounding number. Refuse with exactly "
            "this sentence — and only when the context is genuinely irrelevant to the question "
            "(not when the question is broad):\n"
            '"I don\'t have enough information in the provided documents to answer this."\n'
            "\nDo not use outside knowledge beyond what is in the context. But DO synthesize and "
            "summarize what IS in the context.\n"
        )

    def _model_extra_kwargs(self, model_name: str) -> dict:
        """Per-model tweaks to keep answers fast and direct (no deep reasoning)."""
        kw: dict = {}
        # gpt-oss models on Groq accept reasoning_effort: low|medium|high.
        # 'low' skips the long internal monologue so streaming starts immediately.
        if model_name and "gpt-oss" in model_name.lower():
            kw["reasoning_effort"] = "low"
        return kw

    def _strip_think_tag(self, text: str) -> str:
        """Remove <think>...</think> blocks (used by Qwen reasoning models)."""
        if not text:
            return text
        import re as _re
        return _re.sub(r"<think>.*?</think>\s*", "", text, flags=_re.DOTALL).lstrip()

    def _build_history(
        self,
        conversation_history: Optional[List[Dict]],
        max_tokens: int = 500,
        max_turns: int = 4,
    ) -> str:
        """Take most-recent N turns, then trim oldest until under token budget."""
        if not conversation_history:
            return ""
        turns = conversation_history[-max_turns:]
        rendered = [
            f"{m.get('role', 'user')}: {m.get('content', '')}\n"
            for m in turns
        ]
        # Drop oldest turns until total fits the budget
        while rendered and len(self.encoding.encode("".join(rendered))) > max_tokens:
            rendered.pop(0)
        return "".join(rendered)

    # ---- Vision helpers --------------------------------------------------

    def _collect_image_paths(
        self,
        context_chunks: List[Dict],
        max_images: int = 3,
    ) -> List[str]:
        """Pick out image file paths from retrieved chunks (deduped, capped)."""
        paths: List[str] = []
        seen: set = set()
        for chunk in context_chunks:
            payload = chunk.get("payload", chunk) or {}
            if not payload.get("is_image"):
                continue
            fp = payload.get("file_path")
            if not fp or fp in seen:
                continue
            if not os.path.exists(fp):
                logger.warning(f"Image file missing on disk: {fp}")
                continue
            seen.add(fp)
            paths.append(fp)
            if len(paths) >= max_images:
                break
        return paths

    def _encode_image_data_url(self, file_path: str, max_dim: int = 1024) -> str:
        """Read, downscale, JPEG-encode an image to a base64 data URL.

        We resize to keep token count reasonable — Groq's vision models have
        per-request size limits and large images can blow up the payload.
        """
        if not _PIL_AVAILABLE:
            raise RuntimeError("Pillow is required for vision support.")
        with Image.open(file_path) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"

    def _build_messages(
        self,
        system_prompt: str,
        user_prompt: str,
        image_paths: List[str],
        inline_image_data_urls: Optional[List[str]] = None,
        override_model: Optional[str] = None,
    ):
        """Returns (messages, model_to_use). Multimodal if any images present.

        image_paths: image files on disk (from indexed/retrieved image documents)
        inline_image_data_urls: base64 data URLs (e.g. user drag/dropped in chat)
        """
        model = override_model or self.model
        inline = inline_image_data_urls or []
        if not image_paths and not inline:
            return (
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                model,
            )

        user_content: List[Dict] = [{"type": "text", "text": user_prompt}]
        for path in image_paths:
            try:
                data_url = self._encode_image_data_url(path)
                user_content.append(
                    {"type": "image_url", "image_url": {"url": data_url}}
                )
            except Exception as e:
                logger.warning(f"Skipping image {path}: {e}")
        for data_url in inline:
            if isinstance(data_url, str) and data_url.startswith("data:image/"):
                user_content.append(
                    {"type": "image_url", "image_url": {"url": data_url}}
                )
            else:
                logger.warning("Skipping inline image: not a data URL")

        return (
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            self.vision_model,
        )
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    def generate_response(self, query: str, context_chunks: List[Dict],
                        conversation_history: Optional[List[Dict]] = None,
                        attached_images: Optional[List[str]] = None,
                        temperature: float = 0.1,
                        max_tokens: int = 800,
                        groq_api_key: Optional[str] = None,
                        override_model: Optional[str] = None,
                        custom_base_url: Optional[str] = None,
                        custom_api_key: Optional[str] = None) -> str:
        """Generate response using Groq (or a caller-configured OpenAI-
        compatible endpoint) with retrieved context.

        groq_api_key: when set (demo mode), the call is billed against the
        caller's own key instead of the server's.
        custom_base_url/custom_api_key: when set, the request goes to that
        OpenAI-compatible endpoint instead of Groq entirely (e.g. Mistral,
        OpenRouter, a self-hosted server) — override_model selects which
        model on that endpoint to call.
        """

        # Build context with token budget so we never exceed Groq's TPM
        context, allowed_ids = self._build_context(context_chunks, max_context_tokens=4500)

        # Build conversation history
        history_str = self._build_history(conversation_history, max_tokens=500)

        # Construct prompt
        has_images = bool(attached_images) or any((c.get("payload", c) or {}).get("is_image") for c in context_chunks)
        has_text_context = bool(context.strip())
        system_prompt = self._build_system_prompt(
            has_images, has_text_context, agent_prompt=agent_prompt,
        )

        newline = "\n"
        history_block = f"Conversation History:{newline}{history_str}{newline}" if history_str else ""
        ids_list = ", ".join(f"[{i}]" for i in allowed_ids) if allowed_ids else "(none)"
        allowed_block = (
            f"VALID CITATION IDS — you may ONLY use these exact markers, no others:\n"
            f"{ids_list}\n"
            f"If you write any other ID like [1.5] or [2.1] when it is not in the list above, "
            f"that is a hallucination and is FORBIDDEN.\n\n"
        )
        user_prompt = f"""{allowed_block}Context:
{context}

{history_block}Question: {query}

Answer with citations using ONLY the valid IDs listed above:"""
        
        image_paths = self._collect_image_paths(context_chunks)
        messages, model_to_use = self._build_messages(
            system_prompt, user_prompt, image_paths,
            inline_image_data_urls=attached_images,
            override_model=override_model,
        )
        total_images = len(image_paths) + (len(attached_images) if attached_images else 0)
        logger.info(
            f"[CHAT LLM] Selected Model: '{model_to_use}' | Vision Active: {bool(total_images)} "
            f"({total_images} image(s))"
        )

        try:
            client = self._client_for(
                groq_api_key, custom_base_url=custom_base_url, custom_api_key=custom_api_key
            )
            response = client.chat.completions.create(
                model=model_to_use,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=0.9,
                **self._model_extra_kwargs(model_to_use),
            )

            return self._strip_think_tag(response.choices[0].message.content)

        except Exception as e:
            logger.error(f"Error generating response: {e}")
            raise
    
    def generate_streaming_response(self, query: str, context_chunks: List[Dict],
                                    conversation_history: Optional[List[Dict]] = None,
                                    attached_images: Optional[List[str]] = None,
                                    temperature: float = 0.1,
                                    max_tokens: int = 800,
                                    groq_api_key: Optional[str] = None,
                                    override_model: Optional[str] = None,
                                    custom_base_url: Optional[str] = None,
                                    custom_api_key: Optional[str] = None,
        agent_prompt: Optional[str] = None):
        """Generate streaming response.

        groq_api_key: when set (demo mode), the call is billed against the
        caller's own key instead of the server's.
        custom_base_url/custom_api_key: when set, the request goes to that
        OpenAI-compatible endpoint instead of Groq entirely.
        """

        # Hierarchical [Source N.M] builder + allowlist of valid IDs
        context, allowed_ids = self._build_context(context_chunks, max_context_tokens=4500)

        history_str = self._build_history(conversation_history, max_tokens=500)

        has_images = bool(attached_images) or any((c.get("payload", c) or {}).get("is_image") for c in context_chunks)
        has_text_context = bool(context.strip())
        system_prompt = self._build_system_prompt(
            has_images, has_text_context, agent_prompt=agent_prompt,
        )

        newline = "\n"
        history_block = f"Conversation History:{newline}{history_str}{newline}" if history_str else ""
        ids_list = ", ".join(f"[{i}]" for i in allowed_ids) if allowed_ids else "(none)"
        allowed_block = (
            f"VALID CITATION IDS — you may ONLY use these exact markers, no others:\n"
            f"{ids_list}\n"
            f"Inventing any other ID (e.g. [1.5] or [2.1] when not listed) is FORBIDDEN.\n\n"
        )
        user_prompt = f"""{allowed_block}Context:
{context}

{history_block}Question: {query}

Answer with citations using ONLY the valid IDs listed above:"""
        
        image_paths = self._collect_image_paths(context_chunks)
        messages, model_to_use = self._build_messages(
            system_prompt, user_prompt, image_paths,
            inline_image_data_urls=attached_images,
            override_model=override_model,
        )
        total_images = len(image_paths) + (len(attached_images) if attached_images else 0)
        logger.info(
            f"[CHAT LLM STREAM] Selected Model: '{model_to_use}' | Vision Active: {bool(total_images)} "
            f"({total_images} image(s))"
        )

        try:
            client = self._client_for(
                groq_api_key, custom_base_url=custom_base_url, custom_api_key=custom_api_key
            )
            stream = client.chat.completions.create(
                model=model_to_use,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
                **self._model_extra_kwargs(model_to_use),
            )

            # Only Qwen-family models use <think> tags. For others, just stream
            # content tokens directly with no filtering.
            uses_think_tags = "qwen" in (model_to_use or "").lower()

            if not uses_think_tags:
                for chunk in stream:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
            else:
                # <think>...</think> stripper for Qwen reasoning models.
                in_think = False
                buffer = ""
                for chunk in stream:
                    delta = chunk.choices[0].delta.content
                    if not delta:
                        continue
                    buffer += delta

                    progressed = True
                    while buffer and progressed:
                        progressed = False
                        if in_think:
                            end = buffer.find("</think>")
                            if end == -1:
                                buffer = ""
                                break
                            buffer = buffer[end + len("</think>"):].lstrip()
                            in_think = False
                            progressed = True
                        else:
                            start = buffer.find("<think>")
                            if start == -1:
                                # Hold back trailing chars only if they could
                                # be the START of "<think>" (prefix match), so
                                # we never accidentally swallow a stray "<".
                                hold = 0
                                for n in range(min(7, len(buffer)), 0, -1):
                                    if "<think>".startswith(buffer[-n:]):
                                        hold = n
                                        break
                                if hold:
                                    yield buffer[:-hold]
                                    buffer = buffer[-hold:]
                                else:
                                    yield buffer
                                    buffer = ""
                                break
                            if start > 0:
                                yield buffer[:start]
                            buffer = buffer[start + len("<think>"):]
                            in_think = True
                            progressed = True
                if buffer and not in_think:
                    yield buffer

        except Exception as e:
            logger.error(f"Error in streaming: {e}")
            raise
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.encoding.encode(text))
