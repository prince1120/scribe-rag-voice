"""Safety and physical-hazard guardrails for Product QR troubleshooting.

Indian D2C appliances and hardware (water purifiers, induction cooktops,
microwaves, water heaters, EV chargers, solar inverters) operate on high
voltage, pressurized fluids, or combustible gases. Providing hallucinated DIY
instructions to bypass thermal fuses, open live electrical enclosures, or
tamper with safety valves introduces extreme physical liability and safety risk.

This module acts as a strict, deterministic pre-generation guardrail.
If a query indicates hazardous physical intervention, the system abstains
immediately and returns an authoritative safety warning directing the user
to an authorized brand service technician.
"""
import re
from typing import Optional

SAFETY_WARNING_MESSAGE = (
    "Safety Warning: Servicing internal electrical, gas, or high-voltage components "
    "poses serious safety risks and may void your warranty. Please disconnect "
    "power/fuel immediately and contact an authorized service technician for assistance."
)

ABSTENTION_MESSAGE = (
    "I couldn't find that information in this product's official support material. "
    "Please contact the brand's support team."
)

# Deterministic regex patterns for hazardous repair intents
_HAZARD_PATTERNS = [
    # High voltage / live electrical / bypassing safety
    re.compile(r"\b(?:bypass|short|jump|bridge)\b.*\b(?:fuse|thermal(?:\s*cut(?:off)?)?|cutoff|cut-off|safety\s*switch|breaker|interlock|thermostat)\b", re.IGNORECASE),
    re.compile(r"\b(?:open|disassemble|remove)\b.*\b(?:magnetron|capacitor|high\s*voltage|power\s*supply\s*board|internal\s*enclosure)\b", re.IGNORECASE),
    re.compile(r"\b(?:rewire|rewiring|hotwire|tamper)\b.*\b(?:cord|plug|ground|earth|mains|transformer)\b", re.IGNORECASE),
    re.compile(r"\b(?:electric\s*shock|sparks?|sparking|smoking|burning\s*smell|smoke\s*coming)\b", re.IGNORECASE),
    
    # Gas / Combustion / Refrigerant / Pressure vessels
    re.compile(r"\b(?:gas\s*leak|smell\s*gas|lpg\s*leak|cylinder\s*leak)\b", re.IGNORECASE),
    re.compile(r"\b(?:refrigerant|freon|gas\s*charge|compressor\s*puncture)\b", re.IGNORECASE),
    re.compile(r"\b(?:bypass|remove|tamper)\b.*\b(?:pressure\s*relief\s*valve|prv|safety\s*valve)\b", re.IGNORECASE),
    
    # High-voltage EV charging & solar inverter internal hazard
    re.compile(r"\b(?:open|probe|solder)\b.*\b(?:inverter\s*board|ev\s*charger\s*internal|high\s*dc\s*bus)\b", re.IGNORECASE),
]


def is_safety_sensitive_query(query: str) -> bool:
    """True if the query triggers hazardous physical appliance repair rules."""
    if not query:
        return False
    q = query.strip()
    return any(p.search(q) for p in _HAZARD_PATTERNS)


def check_product_safety(query: str) -> Optional[str]:
    """Inspects query. Returns safety warning string if hazard detected, otherwise None."""
    if is_safety_sensitive_query(query):
        return SAFETY_WARNING_MESSAGE
    return None
