from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any
from enum import Enum


class DocumentType(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    PPTX = "pptx"
    TXT = "txt"
    MD = "md"
    HTML = "html"
    CSV = "csv"
    XLSX = "xlsx"
    IMG = "img"
    AUDIO = "audio"
    VIDEO = "video"


class DocumentMetadata(BaseModel):
    filename: str
    file_type: DocumentType
    file_size: int
    page_count: Optional[int] = None
    upload_timestamp: str
    tenant_id: str = "default"
    custom_metadata: Optional[Dict[str, Any]] = None


class DocumentChunk(BaseModel):
    chunk_id: str
    document_id: str
    content: str
    chunk_index: int
    metadata: Dict[str, Any]
    embedding: Optional[List[float]] = None


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    conversation_id: Optional[str] = None
    top_k: Optional[int] = Field(default=None, ge=1, le=50)
    filters: Optional[Dict[str, Any]] = None
    document_ids: Optional[List[str]] = None
    # base64 data URLs of images attached to this query (e.g. drag/dropped in chat)
    attached_images: Optional[List[str]] = None
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=50, le=4000)
    model: Optional[str] = None

    @field_validator("query")
    @classmethod
    def _strip_query(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("query must not be blank")
        return v


class SourceCitation(BaseModel):
    document_id: str
    filename: str
    chunk_id: str
    page_number: Optional[int] = None
    score: float
    snippet: str


class QueryResponse(BaseModel):
    answer: str
    citations: List[SourceCitation]
    conversation_id: str
    processing_time_ms: int
    retrieval_ms: Optional[int] = None
    llm_ms: Optional[int] = None


class PasteTextRequest(BaseModel):
    title: str = Field(default="Pasted text", max_length=200)
    content: str = Field(..., min_length=1, max_length=2_000_000)

    @field_validator("content")
    @classmethod
    def _strip_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be blank")
        return v


class DocumentUploadResponse(BaseModel):
    document_id: str
    filename: str
    status: str
    message: str
    chunk_count: Optional[int] = None


class ConversationMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: str
    citations: Optional[List[SourceCitation]] = None


class Conversation(BaseModel):
    conversation_id: str
    tenant_id: str
    messages: List[ConversationMessage]
    created_at: str
    updated_at: str


class DocumentContentResponse(BaseModel):
    document_id: str
    filename: str
    content: str
    editable: bool
    is_image: bool = False


class DocumentContentUpdate(BaseModel):
    content: str = Field(..., max_length=2_000_000)


class HealthResponse(BaseModel):
    status: str
    version: str = "1.0.0"
    components: Dict[str, str]


class VoiceTokenRequest(BaseModel):
    # Room is optional — if omitted, a fresh one is generated per session so
    # unrelated callers never land in the same voice room by accident.
    room_name: Optional[str] = Field(default=None, max_length=128)
    participant_name: Optional[str] = Field(default=None, max_length=128)
    # Chosen TTS voice id (validated server-side against the supported set).
    tts_speaker: Optional[str] = Field(default=None, max_length=64)
    # RAG on -> answer from the user's uploaded docs; off -> a persona bot.
    rag_enabled: bool = False
    persona: Optional[str] = Field(default=None, max_length=64)
    # Generous char ceiling as a first line of defense; the real limit is
    # the ~1000-word check below (a "word" here can be longer than average,
    # so this allows headroom without permitting a runaway prompt).
    custom_prompt: Optional[str] = Field(default=None, max_length=8000)
    llm_model: Optional[str] = None
    greet_on_connect: bool = True
    greeting_text: Optional[str] = None
    # When set, the voice worker calls this OpenAI-compatible endpoint
    # instead of Groq for this session (llm_model above selects which model
    # on it to use). The matching API key travels as a header, not here —
    # same reason request bodies never carry the other provider keys.
    custom_llm_base_url: Optional[str] = Field(default=None, max_length=512)
    # Same knobs as text chat's QueryRequest — the Settings panel's
    # temperature/max-tokens sliders should apply to voice too.
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=50, le=4000)

    @field_validator("custom_prompt")
    @classmethod
    def _limit_custom_prompt_words(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v.split()) > 1000:
            raise ValueError("custom_prompt must be 1000 words or fewer")
        return v
    # The text conversation to continue, so voice knows what was already
    # discussed. Tenancy is resolved server-side from the session, never here.
    conversation_id: Optional[str] = Field(default=None, max_length=128)


class VoiceRetrieveRequest(BaseModel):
    query: str = Field(..., max_length=4000)
    tenant_id: str = "default"
    top_k: Optional[int] = Field(default=None, ge=1, le=20)


class VoiceTokenResponse(BaseModel):
    token: str
    url: str
    room_name: str
    participant_identity: str


class VoicePreviewRequest(BaseModel):
    speaker: str = Field(..., max_length=64)
