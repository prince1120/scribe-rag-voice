"""Vision-based OCR using Groq's free vision model.

Replaces Tesseract — no system binary required, more accurate on slides /
diagrams / mixed layouts. Uses qwen/qwen3.6-27b on
Groq's free tier.
"""
import base64
import io
import logging
from typing import Union

import groq
from PIL import Image

logger = logging.getLogger(__name__)


_OCR_PROMPT = (
    "Extract ALL text content visible in this image. Output ONLY the raw text "
    "exactly as it appears, preserving structure (headings, bullets, paragraphs). "
    "Include text inside diagrams, charts, tables, or labels. "
    "Do NOT add commentary, summaries, or explanations. "
    "If there is no readable text at all, output exactly: [No readable text]"
)


class VisionOCR:
    """Groq vision-model wrapper for image-to-text extraction."""

    def __init__(
        self,
        groq_api_key: str,
        model: str = "qwen/qwen3.6-27b",
    ):
        self.client = groq.Groq(api_key=groq_api_key)
        self.model = model

    def _to_data_url(self, image: Union[str, Image.Image], max_dim: int = 1280) -> str:
        """Resize and JPEG-encode an image (path or PIL) to a base64 data URL."""
        if isinstance(image, str):
            img = Image.open(image)
        else:
            img = image

        try:
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        finally:
            if isinstance(image, str):
                img.close()

        return f"data:image/jpeg;base64,{b64}"

    def extract_text(self, image: Union[str, Image.Image]) -> str:
        """Return text extracted from the image. Empty string if none found."""
        try:
            data_url = self._to_data_url(image)
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _OCR_PROMPT},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    }
                ],
                temperature=0.0,
                max_tokens=2048,
            )
            text = (response.choices[0].message.content or "").strip()
            if text == "[No readable text]":
                return ""
            return text
        except Exception as e:
            logger.error(f"Vision OCR failed: {e}")
            raise