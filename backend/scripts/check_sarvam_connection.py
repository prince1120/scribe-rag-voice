"""Manual minimal Sarvam check. Never prints credentials or account identities."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from sqlalchemy import text
from app.config import settings
from app.database import engine
from app.services.secrets_box import decrypt
from app.services.llm_connection import verify_connection, ConnectionError


async def main():
    key = settings.SARVAM_API_KEY
    rows = []
    try:
        if "--server-key" in sys.argv:
            raise RuntimeError("Server-key check requested")
        async with engine.connect() as connection:
            rows = (await connection.execute(text(
                "SELECT a.llm_model, a.voice_model, a.chat_model, a.status, a.published_config, o.sarvam_key_enc "
                "FROM agents a JOIN owners o ON a.tenant_id = o.tenant_id"
            ))).mappings().all()
    except Exception as exc:
        if "--server-key" in sys.argv:
            print(json.dumps({"key_source": "server", "key_configured": bool(key)}))
        else:
            print(json.dumps({"database_read": "unavailable", "error_type": type(exc).__name__, "using_server_key": bool(key)}))
    if "--inspect" in sys.argv:
        for row in rows:
            published = json.loads(row["published_config"] or "{}")
            print(json.dumps({"draft_model": row["llm_model"] or row["voice_model"], "status": row["status"],
                "published_model": published.get("llm_model") or published.get("voice_model"),
                "saved_sarvam_key": bool(row["sarvam_key_enc"]), "server_sarvam_key": bool(key)}))
        await engine.dispose()
        return
    candidates = [row for row in rows if row["sarvam_key_enc"]]
    if len(candidates) == 1:
        key = decrypt(candidates[0]["sarvam_key_enc"])
        print(json.dumps({"saved_models": [candidates[0][name] for name in ("llm_model", "voice_model", "chat_model")]}))
    elif len(candidates) > 1:
        print("Multiple saved Sarvam accounts; cannot choose the affected account safely.")
        await engine.dispose()
        return
    if not key:
        print("No usable Sarvam key in this backend configuration.")
        await engine.dispose()
        return
    if "--verify" in sys.argv:
        for model in ("sarvam-105b-conversations", "sarvam-105b"):
            try:
                await verify_connection({"model": model, "base_url": "https://api.sarvam.ai/v1", "api_key": key})
                print(json.dumps({"model": model, "application_connection_test": "passed"}))
            except ConnectionError as exc:
                print(json.dumps({"model": model, "application_connection_test": "failed", "message": str(exc).replace(key, "[redacted]")}))
        await engine.dispose()
        return
    async with httpx.AsyncClient(timeout=25) as client:
        for model, native_header in [("sarvam-105b-conversations", False), ("sarvam-105b", False), ("sarvam-105b-conversations", True)]:
            headers = {"api-subscription-key": key} if native_header else {"Authorization": f"Bearer {key}"}
            response = await client.post("https://api.sarvam.ai/v1/chat/completions", headers=headers, json={
                "model": model, "messages": [{"role": "user", "content": "Say OK."}],
                "temperature": 0, "max_tokens": 32, "reasoning_effort": None,
            })
            try:
                data = response.json()
            except ValueError:
                data = {}
            error = data.get("error", {})
            error = error if isinstance(error, dict) else {"message": str(error)}
            message = str(error.get("message") or data.get("message") or data.get("detail") or "")
            message = message.replace(key, "[redacted]")[:500]
            print(json.dumps({"model": model, "auth": "subscription" if native_header else "bearer", "status": response.status_code,
                "provider_code": error.get("code"), "message": message,
                "received_text": bool(data.get("choices", [{}])[0].get("message", {}).get("content"))}, ensure_ascii=True))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
