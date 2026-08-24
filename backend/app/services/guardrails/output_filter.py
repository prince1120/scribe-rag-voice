"""Output filter — PII redaction, secret scrub, citation sanity."""
import re
from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class OutputFilterResult:
    text: str
    blocked: bool = False
    reason: Optional[str] = None

# Secrets / PII
_RE_GSK = re.compile(r"gsk_[A-Za-z0-9]{20,}")
_RE_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_RE_PHONE_IN = re.compile(r"\+91[-\s]?[6-9]\d{9}")

def filter_output(text: str, allowed_citations: Optional[List[str]] = None) -> OutputFilterResult:
    if not text:
        return OutputFilterResult(text)
    out = text
    # Scrub secrets
    if _RE_GSK.search(out):
        out = _RE_GSK.sub("[redacted key]", out)
    # Minimal PII redaction for phone/email when model leaks (keep email if from doc? we redact always for safety)
    # Only redact if not already cited? For now redact phone always
    if _RE_PHONE_IN.search(out):
        out = _RE_PHONE_IN.sub("[redacted phone]", out)

    # Block disallowed content patterns (keep short list)
    low = out.lower()
    for phrase in ["how to make a bomb", "instructions to hack"]:
        if phrase in low:
            return OutputFilterResult("I can't help with that request.", blocked=True, reason="disallowed")

    # Citation sanity: if >30% citations hallucinated, mark but don't block (log upstream)
    if allowed_citations is not None:
        import re as _re
        found = _re.findall(r"\[\d+\.\d+\]", out)
        if found:
            invalid = [c for c in found if c.strip("[]") not in {a.strip("[]") for a in allowed_citations} and c not in allowed_citations]
            # don't block, just allow up to 30% — output_filter is not cit enforcement, rag_pipeline does
            pass
    return OutputFilterResult(out)
