import redis
from typing import List, Dict, Any, Optional
import json
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ConversationService:
    """Manage conversation history and memory."""
    
    def __init__(self, redis_host: str = "localhost", redis_port: int = 6379, 
                 redis_password: str = ""):
        try:
            self.redis = redis.Redis(
                host=redis_host,
                port=redis_port,
                password=redis_password,
                decode_responses=True,
                db=0
            )
            self.redis.ping()
            self.use_redis = True
            logger.info("Connected to Redis")
        except Exception as e:
            logger.warning(f"Redis not available: {e}. Using in-memory storage.")
            self.use_redis = False
            self.memory_store = {}
    
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
        """Retrieve a conversation by ID."""
        try:
            if self.use_redis:
                data = self.redis.get(f"conv:{conversation_id}")
                if data:
                    return json.loads(data)
            else:
                return self.memory_store.get(conversation_id)
        except Exception as e:
            logger.error(f"Error getting conversation: {e}")
        
        return None
    
    def get_conversation_history(self, conversation_id: str, 
                                max_messages: int = 10) -> List[Dict]:
        """Get conversation history for context."""
        conversation = self.get_conversation(conversation_id)
        if conversation:
            return conversation["messages"][-max_messages:]
        return []
    
    def delete_conversation(self, conversation_id: str):
        """Delete a conversation."""
        try:
            if self.use_redis:
                self.redis.delete(f"conv:{conversation_id}")
            else:
                self.memory_store.pop(conversation_id, None)
            logger.info(f"Deleted conversation: {conversation_id}")
        except Exception as e:
            logger.error(f"Error deleting conversation: {e}")
    
    def _save_conversation(self, conversation: Dict):
        """Save conversation to storage."""
        try:
            if self.use_redis:
                self.redis.setex(
                    f"conv:{conversation['conversation_id']}",
                    86400,  # 24 hour TTL
                    json.dumps(conversation)
                )
            else:
                self.memory_store[conversation['conversation_id']] = conversation
        except Exception as e:
            logger.error(f"Error saving conversation: {e}")
