"""Persist complete agent drafts and immutable published configurations."""
import json
from types import SimpleNamespace

CONFIG_FIELDS = (
    "llm_model", "llm_base_url", "llm_api_key_enc",
    "name", "script", "voice_script", "chat_script", "voice_id", "language",
    "stt_model", "tts_model", "greeting", "rag_enabled", "voice_rag_enabled",
    "chat_rag_enabled", "style_rules_enabled", "voice_model", "chat_model",
    "voice_base_url", "chat_base_url", "voice_api_key_enc", "chat_api_key_enc",
    "voice_temperature", "chat_temperature", "voice_max_tokens", "chat_max_tokens",
)


def configuration(record) -> dict:
    return {field: getattr(record, field, None) for field in CONFIG_FIELDS}


def serialize(record) -> str:
    return json.dumps(configuration(record), sort_keys=True)


def published_agent(record):
    if record is None or not getattr(record, "published_config", None):
        return record
    return SimpleNamespace(
        **json.loads(record.published_config), tenant_id=record.tenant_id,
        status=record.status, deployed_at=record.deployed_at,
        active_snapshot_id=getattr(record, "active_snapshot_id", None),
    )
