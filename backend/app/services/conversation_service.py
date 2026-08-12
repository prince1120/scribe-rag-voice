import redis
from typing import List, Dict, Any, Optional
import json
import time
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ConversationService:
    """Manage conversation history and memory."""
    
    # How long to wait before giving up on Redis and serving from memory.
    # Without these the client blocks indefinitely: the socket defaults are
    # None, so an unreachable-but-not-refusing Redis (a dropped route, a
    # firewall blackhole, a paused free-tier instance) hangs the calling thread
    # forever rather than failing.
    _SOCKET_TIMEOUT_S = 1.0

    # How long a failed connection is remembered before trying again. The
    # previous code decided `use_redis` once, at construction: a Redis that was
    # briefly down at boot meant the process ran on a non-durable in-memory dict
    # for its entire lifetime, silently, and inconsistently across workers.
    _RETRY_AFTER_S = 30.0

    # Ceiling on the in-memory fallback. Redis entries expire after 24h; this
    # dict had no expiry and no bound at all, so a process running without Redis
    # accumulated every conversation it ever served until it ran out of memory.
    _MEMORY_MAX_CONVERSATIONS = 500

    def __init__(self, redis_host: str = "localhost", redis_port: int = 6379,
                 redis_password: str = ""):
        self.memory_store: Dict[str, Dict] = {}
        self._redis_down_until = 0.0
        self.redis = None
        try:
            self.redis = redis.Redis(
                host=redis_host,
                port=redis_port,
                password=redis_password,
                decode_responses=True,
                db=0,
                socket_timeout=self._SOCKET_TIMEOUT_S,
                socket_connect_timeout=self._SOCKET_TIMEOUT_S,
                retry_on_timeout=False,
                health_check_interval=30,
            )
            self.redis.ping()
            logger.info("Connected to Redis")
        except Exception as e:
            logger.warning(
                "Redis not available at startup: %s. Serving conversations from "
                "memory and retrying every %.0fs.", e, self._RETRY_AFTER_S,
            )
            self._redis_down_until = time.monotonic() + self._RETRY_AFTER_S

    @property
    def use_redis(self) -> bool:
        """Whether to attempt Redis right now.

        A property rather than a flag fixed at construction, so a Redis that
        recovers is picked back up instead of being written off for the life of
        the process.
        """
        return self.redis is not None and time.monotonic() >= self._redis_down_until

    def _mark_down(self, exc: Exception) -> None:
        logger.warning(
            "Redis call failed (%s); using in-memory conversations for %.0fs.",
            exc, self._RETRY_AFTER_S,
        )
        self._redis_down_until = time.monotonic() + self._RETRY_AFTER_S


    def ping(self) -> bool:
        """Health-check helper: True if Redis is reachable, False if running
        on the in-memory fallback (which is a degraded, non-durable mode)."""
        if not self.use_redis:
            return False
        try:
            return bool(self.redis.ping())
        except Exception:
            return False

    def create_conversation(self, tenant_id: str) -> str:
        """Create a new conversation."""
        from uuid import uuid4
        conversation_id = str(uuid4())
        
        conversation = {
            "conversation_id": conversation_id,
            "tenant_id": tenant_id,
            "messages": [],
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        self._save_conversation(conversation)
        return conversation_id
    
    def add_message(self, conversation_id: str, role: str, content: str,
                    citations: Optional[List[Dict]] = None):
        """Add a message to the conversation."""
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "citations": citations or []
        }
        
        conversation = self.get_conversation(conversation_id)
        if conversation:
            conversation["messages"].append(message)
            conversation["updated_at"] = datetime.now().isoformat()
            self._save_conversation(conversation)
        
        return message
    
    def get_conversation(self, conversation_id: str) -> Optional[Dict]:
        """Retrieve a conversation by ID.

        Falls back to the in-memory copy rather than returning None when Redis
        fails — returning None here reads as "no such conversation" and silently
        drops the user's history mid-chat.
        """
        if self.use_redis:
            try:
                data = self.redis.get(f"conv:{conversation_id}")
                if data:
                    return json.loads(data)
                return self.memory_store.get(conversation_id)
            except Exception as e:
                self._mark_down(e)
        return self.memory_store.get(conversation_id)
    
    def get_conversation_history(self, conversation_id: str, 
                                max_messages: int = 10) -> List[Dict]:
        """Get conversation history for context."""
        conversation = self.get_conversation(conversation_id)
        if conversation:
            return conversation["messages"][-max_messages:]
        return []
    
    def delete_conversation(self, conversation_id: str):
        """Delete a conversation from both stores.

        Both, not one or the other: a delete that only reached Redis would be
        undone the next time a read fell back to memory.
        """
        self.memory_store.pop(conversation_id, None)
        if self.use_redis:
            try:
                self.redis.delete(f"conv:{conversation_id}")
            except Exception as e:
                self._mark_down(e)
        logger.info(f"Deleted conversation: {conversation_id}")
    
    def _save_conversation(self, conversation: Dict):
        """Save conversation to storage.

        Always writes the in-memory copy, even on the Redis path. It is the
        fallback readers use when Redis is unreachable, and a fallback that was
        never written to is just data loss with extra steps. Bounded below so a
        long-running process cannot grow it without limit.
        """
        conversation_id = conversation["conversation_id"]
        self.memory_store[conversation_id] = conversation
        if len(self.memory_store) > self._MEMORY_MAX_CONVERSATIONS:
            # Oldest-inserted first; dicts preserve insertion order.
            for stale in list(self.memory_store)[: len(self.memory_store) // 4]:
                self.memory_store.pop(stale, None)

        if self.use_redis:
            try:
                self.redis.setex(
                    f"conv:{conversation_id}",
                    86400,  # 24 hour TTL
                    json.dumps(conversation),
                )
            except Exception as e:
                self._mark_down(e)
