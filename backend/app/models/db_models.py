from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    tenant_id: Mapped[str] = mapped_column(String(128), index=True, default="default")
    filename: Mapped[str] = mapped_column(String(512))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="processed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ConversationRecord(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    tenant_id: Mapped[str] = mapped_column(String(128), index=True, default="default")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    messages: Mapped[List["MessageRecord"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class MessageRecord(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.conversation_id"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    conversation: Mapped["ConversationRecord"] = relationship(back_populates="messages")


class ContactRecord(Base):
    """A person the owner has shared access with.

    Their identity is the link they were given, so there is no signup, no
    password, and nothing for them to remember. Everything they ever say is
    attributed here rather than to an anonymous session.
    """
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contact_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    owner_tenant_id: Mapped[str] = mapped_column(String(128), index=True, default="default")
    name: Mapped[str] = mapped_column(String(200))
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # "voice" opens straight into a call; "chat" is text only; "both" shows the
    # normal app. A voice-only link is the common case for someone who should
    # just talk and never browse the library.
    #
    # Stored as `access_mode`: PostgreSQL parses a bare `mode` as the built-in
    # ordered-set aggregate mode(), so selecting the column failed with
    # "WITHIN GROUP is required for ordered-set aggregate mode". The Python
    # attribute stays `mode` so the API surface is unaffected.
    mode: Mapped[str] = mapped_column("access_mode", String(16), default="both")

    # Only the SHA-256 of the invite token is stored. A leaked database should
    # not hand over working links, and the plaintext is shown to the owner once
    # at creation for exactly that reason.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    # First device to open the link claims it; later devices are refused. This
    # is what makes a forwarded WhatsApp link useless to whoever receives it.
    bound_device: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Optional second factor for sensitive contacts, delivered out of band so
    # one leaked channel is not enough.
    pin: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)

    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Blocking is not revoking. Revoke invalidates the link; block refuses the
    # person while keeping their link and their history intact, which is what
    # an owner wants when someone misuses access rather than loses it.
    blocked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Cap so a leaked link cannot drain the LLM quota before anyone notices.
    max_sessions_per_day: Mapped[int] = mapped_column(Integer, default=20)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ContactSessionRecord(Base):
    """One visit by a contact.

    Recorded per visit rather than per message so the owner sees "Ramesh: 3
    conversations this week" instead of an undifferentiated wall of turns, and
    so an unfamiliar device or address is visible at a glance.
    """
    __tablename__ = "contact_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    contact_id: Mapped[str] = mapped_column(String(36), index=True)
    conversation_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Kept for anomaly review by the owner, not for tracking: a session from a
    # new device or a distant address is the signal that a link has spread.
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    device_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    channel: Mapped[str] = mapped_column(String(16), default="chat")  # chat | voice
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    message_count: Mapped[int] = mapped_column(Integer, default=0)


class OwnerRecord(Base):
    """A workspace, and the mode that decides which product it is.

    Identity is the tenant id already derived from the owner's own API keys, so
    this table adds no new authentication — it records what that tenant *is*.
    Created lazily on first arrival rather than at signup, because there is no
    signup: bringing your own keys is the whole account creation step.
    """
    __tablename__ = "owners"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    # "personal" is today's app unchanged. "business" replaces the document
    # library with an agent other people call. Asked once, changeable later.
    mode: Mapped[str] = mapped_column("workspace_mode", String(16), default="personal")
    # Null until the owner actually answers Personal-or-Business. Without this
    # the default mode is indistinguishable from a deliberate choice, so the
    # question could never be asked exactly once.
    mode_chosen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Business only. Category is asked because it is the cheapest way to learn
    # what people actually build with this.
    business_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    business_category: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Set only by business owners, who need to return daily on devices that may
    # not be theirs. Personal users are identified by the keys they already
    # hold; callers by the link they were sent. Neither ever signs in.
    email: Mapped[Optional[str]] = mapped_column(String(320), unique=True, nullable=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class AgentRecord(Base):
    """The one assistant a business owner configures.

    One per owner by construction — `tenant_id` is unique, not just indexed.
    A list of agents would mean a picker, a default, and a per-link choice;
    none of that earns its complexity for a single business phone line.
    """
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    # What the assistant calls itself, distinct from the business name — a
    # clinic called "Sharma Dental" may want an agent called "Asha".
    name: Mapped[str] = mapped_column(String(120), default="Assistant")

    # "draft" until the owner deploys. A link must never connect to a
    # half-written prompt, so deploy is an explicit gate rather than an
    # implicit consequence of saving.
    status: Mapped[str] = mapped_column(String(16), default="draft")
    deployed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # The owner's main lever: who the assistant is and how it speaks.
    script: Mapped[str] = mapped_column(Text, default="")
    voice_id: Mapped[str] = mapped_column(String(64), default="anushka")
    rag_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    greeting: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
