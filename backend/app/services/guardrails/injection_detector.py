"""Heuristic prompt-injection detector — <80 lines, no LLM call.

Catches direct and indirect (doc-carried) injection before we pay for LLM.
Fail-safe: returns is_injection False on edge, caller decides block vs log.
Keep patterns small + auditable.
"""
import re
from dataclasses import dataclass
from typing import Optional

@dataclass
class InjectionResult:
    is_injection: bool
    reason: Optional[str] = None
    matched: Optional[str] = None

# Direct instruction override attempts
_PATTERNS = [
    r"ignore\s+(previous|above|all)\s+instructions",
    r"disregard\s+.*instructions",
    r"you\s+are\s+now\s+(dan|jailbreak|uncensored)",
    r"reveal\s+(system|prompt|instructions)",
    r"repeat\s+your\s+system\s+prompt",
    r"output\s+your\s+initial\s+instructions",
    r"do\s+anything\s+now",
    r"developer\s+mode",
    r"system\s*:\s*",
    r"\[INST\]|\[/INST\]|<<SYS>>|<\|im_start\|>",
    r"base64\s*:\s*[A-Za-z0-9+/=]{20,}",
    r"override\s+safety",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _PATTERNS]

# Indirect via document: looks like system inside tool data
_INDIRECT_MARKERS = [
    "system prompt",
    "tool data",
    "ignore voice_script",
]

def _normalize(text: str) -> str:
    # NFKC, strip zero-width, collapse whitespace, lower
    import unicodedata
    t = unicodedata.normalize("NFKC", text or "")
    # zero-width joiner etc
    t = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:4000]  # cap for regex

def is_prompt_injection(text: str) -> InjectionResult:
    if not text or len(text.strip()) < 8:
        return InjectionResult(False)
    norm = _normalize(text)
    for pat, cre in zip(_PATTERNS, _COMPILED):
        m = cre.search(norm)
        if m:
            return InjectionResult(True, reason=f"direct:{pat}", matched=m.group(0)[:80])
    low = norm.lower()
    for marker in _INDIRECT_MARKERS:
        if marker in low and "ignore" in low:
            return InjectionResult(True, reason=f"indirect:{marker}")
    # Obfuscation: long repeated chars or excessive special
    if len(re.findall(r"[A-Za-z0-9]{30,}", norm)) > 2:
        return InjectionResult(True, reason="obfuscation")
    return InjectionResult(False)
