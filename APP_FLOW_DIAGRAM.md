# Scribe AI Voice & Chat Assistant Platform — Complete Master Architecture & Flow Specification

This document provides an exhaustive, end-to-end technical specification and visual flow diagrams covering **every subsystem, lifecycle, data pipeline, security layer, and API route** in the application.

---

## Table of Contents
1. [High-Level System Topology](#1-high-level-system-topology)
2. [Dual-Mode Architecture Overview (Personal vs Business)](#2-dual-mode-architecture-overview-personal-vs-business)
3. [Personal Mode Architecture (3-Pane RAG & Voice Studio)](#3-personal-mode-architecture-3-pane-rag--voice-studio)
   - 3.1 [Pane 1: Knowledge Base & Document Ingestion](#31-pane-1-knowledge-base--document-ingestion)
   - 3.2 [Pane 2: Interactive Chat Studio & Multi-Modal Composer](#32-pane-2-interactive-chat-studio--multi-modal-composer)
   - 3.3 [Pane 3: Source Inspector & In-Line Citations](#33-pane-3-source-inspector--in-line-citations)
   - 3.4 [Embedded Real-Time Voice Call Modal](#34-embedded-real-time-voice-call-modal)
   - 3.5 [Request & Latency Tracking Pipeline](#35-request--latency-tracking-pipeline)
4. [Business Owner Console Lifecycle & Subsystems](#4-business-owner-console-lifecycle--subsystems)
   - 4.1 [Zero-Flicker Workspace Cache & SWR Navigation](#41-zero-flicker-workspace-cache--swr-navigation)
   - 4.2 [Overview Dashboard & Metrics Pipeline](#42-overview-dashboard--metrics-pipeline)
   - 4.3 [Assistant Studio & Dual-Channel Prompt Engine](#43-assistant-studio--dual-channel-prompt-engine)
   - 4.4 [People, Calls & Token Lifecycle Subsystem](#44-people-calls--token-lifecycle-subsystem)
   - 4.5 [Account, Encryption & API Vault](#45-account-encryption--api-vault)
5. [Customer / Caller Interaction Flows](#5-customer--caller-interaction-flows)
   - 5.1 [Public Directory & Smart Caller Deduplication](#51-public-directory--smart-caller-deduplication)
   - 5.2 [Dedicated Token Link & Device Binding Security](#52-dedicated-token-link--device-binding-security)
6. [Real-Time Bidirectional Voice Call Pipeline](#6-real-time-bidirectional-voice-call-pipeline)
7. [Text Chat & RAG Document Grounding Engine](#7-text-chat--rag-document-grounding-engine)
8. [Complete Database Schema & Entity-Relationship Model (ERD)](#8-complete-database-schema--entity-relationship-model-erd)
9. [Comprehensive Backend API Route Directory](#9-comprehensive-backend-api-route-directory)

---

## 2. Dual-Mode Architecture Overview (Personal vs Business)

The platform supports two distinct operational modes determined by the owner's selection in `/setup` and resolved by identity headers (`X-User-Groq-Key`, `X-User-Sarvam-Key`, `X-Client-Id` or session cookie):

```mermaid
flowchart TD
    START["User Opens Application (/)"] --> GATE{"Mode Configured in DB?"}
    GATE -- No --> SETUP["🚀 Setup Gate (/setup): Choose Personal vs Business Mode"]
    
    SETUP --> CHOICE{"Owner Choice"}
    CHOICE -- "Personal Mode" --> PERS["📘 3-Pane Personal RAG & Voice Studio (app/page.tsx)"]
    CHOICE -- "Business Mode" --> BIZ["🏢 Business Voice & Chat Platform Console (/dashboard)"]

    GATE -- "Mode = personal" --> PERS
    GATE -- "Mode = business" --> BIZ
```

---

## 3. Personal Mode Architecture (3-Pane RAG & Voice Studio)

In Personal Mode (`app/page.tsx`), the application presents a sleek, manuscript-toned 3-pane interface designed for intensive document research, multi-modal chat, source verification, and real-time voice conversations.

```mermaid
flowchart LR
    subgraph Pane1["PANE 1: Knowledge Library"]
        UPLOAD["📤 Upload PDF / DOCX / TXT / MD"]
        LIST["📚 Document Selection Chips (Chunk Count, Status)"]
        ACTIONS["🗑️ Delete & Multi-doc Select"]
    end

    subgraph Pane2["PANE 2: Interactive Chat Studio"]
        COMPOSER["📝 Multi-Modal Composer (Text + Image Attachments)"]
        STREAM["⚡ Streaming Markdown Response (Code, Tables)"]
        CIT_MARK["🏷️ Clickable In-Line Citations [1.1], [1.2]"]
        METRICS_BAR["⏱️ Latency Pills: Retrieval ms • TTFT ms • Total ms"]
    end

    subgraph Pane3["PANE 3: Source Inspector (Slide-Over)"]
        CHUNK_VIEW["📄 Full Ground Truth Chunk Content"]
        META["🔍 Filename, Page #, Chunk Index"]
        SCORE["📊 Vector Cosine Similarity Score"]
    end

    subgraph VoiceModal["🎙️ Embedded Voice Modal"]
        V_TALK["Real-Time Voice Call Grounded on Selected Documents"]
    end

    UPLOAD --> LIST --> COMPOSER
    COMPOSER --> STREAM
    STREAM --> CIT_MARK
    CIT_MARK -->|Click Citation| CHUNK_VIEW
    CHUNK_VIEW --> META --> SCORE
    STREAM --> METRICS_BAR
    LIST -.->|Grounding Context| V_TALK
```

### 3.1 Pane 1: Knowledge Base & Document Ingestion
- **Document Uploader**: Ingests files up to 10MB per document (PDF, DOCX, TXT, Markdown).
- **Processing**: Automatically parses text, chunks into overlapping token segments (500 tokens with 50-token overlap), generates vector embeddings, and stores in the local vector index.
- **Selection Chips**: Allows the user to toggle which specific documents to ground their queries against.

### 3.2 Pane 2: Interactive Chat Studio & Multi-Modal Composer
- **Multi-modal Composer**: Accepts text prompts and attached images.
- **In-Line Citations**: Displays clickable citation badges (e.g. `[1.1]`, `[1.2]`) indicating the exact source document and chunk that grounded each assertion.
- **Real-Time Latency Metrics**: Displays detailed timing for transparency:
  - `retrieval_ms`: Vector similarity search latency.
  - `ttft_ms`: Time to first token from Groq LPU.
  - `total_ms`: Total end-to-end response generation time.

### 3.3 Pane 3: Source Inspector & In-Line Citations
- Clicking any citation badge smoothly expands the right-hand slide-over drawer to inspect the exact paragraph, page number, and vector cosine similarity score.

### 3.4 Embedded Real-Time Voice Call Modal
- The floating phone button launches an audio session where the user can speak directly with their documents via Sarvam STT, Groq RAG generation, and Sarvam TTS.

### 3.5 Request & Latency Tracking Pipeline
```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Personal User
    participant UI as 🖥️ 3-Pane Chat (app/page.tsx)
    participant API as 🚀 /api/v1/chat/message
    participant RAG as 📄 Vector Search Engine
    participant Groq as ⚡ Groq Cloud LPU

    User->>UI: Submits question + selected documents
    UI->>API: POST /api/v1/chat/message { prompt, document_ids, images }
    
    API->>RAG: Embed query & perform vector search (Top-K=3)
    RAG-->>API: Returns relevant chunks + records retrieval_ms (e.g. 142ms)
    
    API->>Groq: Stream prompt with ground-truth chunk context
    Groq-->>API: Stream token chunks + records ttft_ms (e.g. 210ms)
    API-->>UI: Stream Markdown text with [display_number] citations
    
    UI-->>User: Live streaming Markdown + clickable citation chips + latency bar
```

---

---

## 1. High-Level System Topology

```mermaid
flowchart TB
    subgraph ClientTier["Frontend Tier (Next.js 16 + React 19 + TypeScript)"]
        direction TB
        subgraph OwnerApp["Business Owner Portal"]
            DASH["📊 Overview Dashboard (/dashboard)"]
            AGENT["🤖 Assistant Studio (/agent)"]
            LINKS["👥 People & Calls (/links)"]
            SETT["⚙️ Account & Keys (/settings)"]
            SHELL["🖥️ Owner Shell Navigation & Status Indicator"]
        end
        subgraph PublicApp["Customer & Caller Interfaces"]
            DIR["🌐 Public Business Directory (/directory)"]
            TOKEN_PAGE["🔗 Dedicated Link Page (/t/:token)"]
            V_CALL["📞 Live Voice Call Audio Engine (Web Audio API)"]
            C_CHAT["💬 Live Text Chat Component"]
        end
        CACHE_LAYER["⚡ Local & Memory Cache (workspaceCache.ts - SWR)"]
    end

    subgraph GatewayTier["API Gateway & Identity Resolution (FastAPI)"]
        direction TB
        GATE["🛡️ Auth & Identity Middleware (identity.py)"]
        ROUTERS["API Routers (/api/v1/...)"]
    end

    subgraph ServiceTier["Backend Core Engines & Services"]
        direction TB
        OWNER_SVC["🏢 Owner & Workspace Service (owner_service.py)"]
        CONTACT_SVC["👥 Contact, Token & Device Engine (contact_service.py)"]
        VOICE_PIPE["🎙️ Real-Time Voice Worker (voice_worker.py)"]
        RAG_PIPE["📄 Document Chunking & Hybrid Search (rag_service.py)"]
        VAULT["🔐 Secrets Cryptography Box (secrets_box.py)"]
    end

    subgraph ExternalAITier["External Cloud AI Infrastructure"]
        direction LR
        GROQ["⚡ Groq Cloud (LLaMA 3.1 8B / 3.3 70B Fast Inference)"]
        SARVAM_STT["🎤 Sarvam STT (Speech Recognition)"]
        SARVAM_TTS["🔊 Sarvam TTS (Persona Voice Synthesis)"]
        CUSTOM_LLM["🌐 Custom OpenAI-compatible Endpoints (OpenRouter / Mistral)"]
    end

    subgraph DataTier["Persistence Tier (SQLAlchemy Async + SQLite / PostgreSQL)"]
        direction TB
        DB_OWNER[("🏢 owners")]
        DB_AGENT[("🤖 agents")]
        DB_CONTACT[("👥 contacts")]
        DB_SESSION[("📞 contact_sessions")]
        DB_TURN[("💬 session_turns")]
        DB_DOCS[("📄 documents")]
    end

    %% Wiring
    OwnerApp --> CACHE_LAYER
    CACHE_LAYER <--> GatewayTier
    PublicApp <--> GatewayTier
    GatewayTier --> GATE
    GATE --> ServiceTier
    ServiceTier --> DataTier
    ServiceTier <--> ExternalAITier
    VOICE_PIPE <--> V_CALL
```

---

## 2. Business Owner Console Lifecycle & Subsystems

### 2.1 Zero-Flicker Workspace Cache & SWR Navigation
The console uses a persistent in-memory singleton coupled with `localStorage` caching to guarantee **0ms immediate UI rendering** when switching screens, eliminating loading stutters and branding flashes.

```mermaid
sequenceDiagram
    autonumber
    actor Owner as 🏢 Business Owner
    participant UI as 🖥️ Console Screen (Dashboard / Agent / Links / Settings)
    participant Cache as ⚡ workspaceCache.ts (Memory + Storage)
    participant Backend as 🚀 FastAPI Server
    participant DB as 💾 Database

    Note over Owner, Cache: Instant Screen Transition (0ms Latency)
    Owner->>UI: Clicks tab (e.g. /agent)
    UI->>Cache: Read getWorkspaceCache() synchronously
    Cache-->>UI: Returns { businessName: "Shiro art and craft", status: "deployed", config: {...} }
    UI-->>Owner: Screen renders immediately in 0ms (No placeholder flicker)

    Note over UI, DB: Background Stale-While-Revalidate (SWR)
    UI->>Backend: Asynchronous background fetch (/api/v1/workspace & /api/v1/workspace/agent)
    Backend->>DB: Query fresh workspace status
    DB-->>Backend: Latest DB records
    Backend-->>UI: Return fresh payload
    UI->>Cache: setWorkspaceCache(freshData)
    Cache-->>UI: Dispatch updates to subscribed components if changed
```

---

### 2.2 Overview Dashboard & Metrics Pipeline
Aggregates total completed talks, voice calls vs text chats, unique callers, and presents paginated dialogue sessions with slide-over transcript inspection.

```mermaid
flowchart LR
    subgraph Aggregation["Metrics Aggregation"]
        Q_SESSIONS["Query contact_sessions WHERE message_count > 0"]
        COUNT_VOICE["Count channel = 'voice'"]
        COUNT_CHAT["Count channel = 'chat'"]
        COUNT_USERS["COUNT(DISTINCT contact_id)"]
    end

    subgraph FilterGhost["Ghost Call Cleanup"]
        FILTER["Filter out 0-turn empty page loads"]
    end

    subgraph UI_View["Dashboard Interface (/dashboard)"]
        CARDS["4 Metric Cards (Total, Voice, Chat, Unique)"]
        TABLE["Paginated Completed Calls Table (5/page)"]
        TRANSCRIPT["Turn-by-Turn Transcript Slide-Over Modal"]
    end

    Q_SESSIONS --> FILTER
    FILTER --> COUNT_VOICE --> CARDS
    FILTER --> COUNT_CHAT --> CARDS
    FILTER --> COUNT_USERS --> CARDS
    FILTER --> TABLE
    TABLE -->|Click 'View Transcript'| TRANSCRIPT
```

---

### 2.3 Assistant Studio & Dual-Channel Prompt Engine
Allows the owner to customize independent conversational prompts for spoken voice calls vs text chat, select TTS voice personas with audio preview, configure multilingual support, and connect custom LLM providers.

```mermaid
flowchart TD
    subgraph Inputs["Assistant Studio Configuration (/agent)"]
        NAME["Assistant Identity (Name & Greeting)"]
        T_VOICE["📞 Voice Prompt Editor (Concise Speech)"]
        T_CHAT["💬 Chat Prompt Editor (Structured Answers)"]
        VOICE_PICKER["🔊 Voice Persona Selector (Anushka, Abhishek, Dhruv, etc.)"]
        LANG_PICKER["🌐 Language Selector (Auto-detect, Hindi, English, etc.)"]
        MODEL_PICKER["⚡ LLM Model Picker (Groq presets vs Custom Endpoints)"]
        RAG_TOGGLE["📄 Document Knowledge Search Toggle (Voice RAG)"]
    end

    subgraph Actions["Lifecycle Actions"]
        SAVE_BTN["💾 Save Assistant Changes (PUT /api/v1/workspace/agent)"]
        DEPLOY_BTN["🚀 Enable / Deploy Live (POST /agent/deploy)"]
        OFFLINE_BTN["⏸️ Disable / Take Offline (POST /agent/undeploy)"]
        RESET_BTN["🗑️ Reset Assistant to Defaults (DELETE /agent)"]
    end

    subgraph Backend_Processing["Backend Validation & Synchronization"]
        SYNC["Synchronize fallback `script` column with `voice_script`"]
        STATUS_UPDATE["Update status: 'deployed' ↔ 'draft'"]
        DB_AGENT[("💾 agents Table")]
    end

    Inputs --> SAVE_BTN
    Inputs --> DEPLOY_BTN
    SAVE_BTN --> SYNC --> DB_AGENT
    DEPLOY_BTN --> STATUS_UPDATE --> DB_AGENT
    OFFLINE_BTN --> STATUS_UPDATE --> DB_AGENT
    RESET_BTN --> DB_AGENT
```

---

### 2.4 People, Calls & Token Lifecycle Subsystem
Manages customer access links, security PINs, device hardware locks, token rotation, and multi-drawer session inspections.

```mermaid
flowchart TD
    subgraph ContactManagement["People & Calls Management (/links)"]
        CREATE_LINK["➕ Generate New Access Link"]
        ROTATE_LINK["🔄 Rotate Link (Revokes old token, keeps history)"]
        BLOCK_USER["🚫 Block / Unblock Contact"]
        DELETE_USER["🗑️ Delete Contact & Dialogue Transcripts"]
        EXPAND_DRAWER["📂 Multi-Drawer Session History Viewer"]
    end

    subgraph SecurityControls["Security & Access Rules"]
        PIN["🔒 Security PIN Hash (Optional 4-6 digit passcode)"]
        DEVICE_LOCK["📱 Hardware Device Fingerprint Hash Lock"]
        MODE_LIMIT["📞 Interaction Allowed (Voice Only / Chat Only / Both)"]
    end

    subgraph StateUpdate["Live UI & Database Sync"]
        BADGE["🏷️ Prominent Badge: '3 Completed Talks'"]
        DB_CONTACTS[("💾 contacts Table")]
        DB_SESSIONS[("💾 contact_sessions Table")]
    end

    CREATE_LINK --> PIN --> DB_CONTACTS
    CREATE_LINK --> MODE_LIMIT --> DB_CONTACTS
    ROTATE_LINK -->|Reset bound_device = NULL| DB_CONTACTS
    BLOCK_USER --> DB_CONTACTS
    DELETE_USER --> DB_CONTACTS
    DELETE_USER -.->|Cascade Delete| DB_SESSIONS
    EXPAND_DRAWER -->|Fetch Sessions| DB_SESSIONS --> BADGE
```

---

### 2.5 Account, Encryption & API Vault
Stores business metadata and securely encrypts external provider API keys using authenticated symmetric encryption.

```mermaid
flowchart LR
    subgraph UI_Settings["Account & Keys (/settings)"]
        PROFILE["🏢 Business Name & Industry Category"]
        KEYS_INPUT["🔑 Groq Key (gsk_...) & Sarvam AI Key"]
        CUSTOM_INPUT["🌐 Custom Endpoint Base URL & Bearer Key"]
        CREDS_INPUT["🛡️ Owner Email & Sign-in Password"]
    end

    subgraph CryptoVault["Encryption Subsystem (secrets_box.py)"]
        FERNET["🔐 Fernet AES-128-CBC + HMAC-SHA256 Encryption"]
        MASK["👁️ Masked Format on Read ('gsk_...3a9f')"]
    end

    subgraph Storage["Encrypted DB Columns"]
        DB_OWNERS[("💾 owners Table")]
    end

    KEYS_INPUT --> FERNET -->|Ciphertext| DB_OWNERS
    CUSTOM_INPUT --> FERNET -->|Ciphertext| DB_OWNERS
    PROFILE --> DB_OWNERS
    CREDS_INPUT --> DB_OWNERS
    DB_OWNERS -->|Decrypted only in worker memory| MASK --> UI_Settings
```

---

## 3. Customer / Caller Interaction Flows

### 3.1 Public Directory & Smart Caller Deduplication
Allows prospective customers to discover businesses and connect instantly without creating duplicate contacts if they return.

```mermaid
sequenceDiagram
    autonumber
    actor Customer as 👤 Customer ("prince")
    participant Directory as 🌐 Directory Page (/directory)
    participant Backend as 🚀 Directory API (/api/v1/directory)
    participant Repo as 🗄️ Contact Repository
    participant DB as 💾 Database
    participant LinkUI as 🔗 Access Link (/t/:token)

    Customer->>Directory: Browses listed businesses & selects "Shiro art and craft"
    Directory->>Directory: Reads cached name from localStorage ("prince")
    Directory->>Customer: Shows "Quick Connect" modal
    Customer->>Directory: Confirms name "prince" & clicks "Start Talk"
    
    Directory->>Backend: POST /api/v1/directory/connect { owner_id, caller_name: "prince" }
    Backend->>Repo: get_active_contact_by_name(owner_id, "prince")
    
    alt Caller has used THIS agent before
        Repo->>DB: Query WHERE owner_tenant_id = owner_id AND name = 'prince' AND NOT revoked
        DB-->>Repo: Found ContactRecord (token: "tok_existing")
        Repo-->>Backend: Reuse existing contact row
        Backend-->>Directory: Return { token: "tok_existing", deduplicated: true }
    else Caller is NEW to this agent
        Repo->>DB: INSERT INTO contacts (owner_tenant_id, name, token, ...)
        DB-->>Repo: Created new ContactRecord (token: "tok_new")
        Repo-->>Backend: New contact created
        Backend-->>Directory: Return { token: "tok_new", deduplicated: false }
    end

    Directory->>LinkUI: Redirect to /t/:token
```

---

### 3.2 Dedicated Token Link & Device Binding Security
Validates security tokens, unlocks PIN gates, enforces hardware device fingerprint binding, and initiates the conversational session.

```mermaid
flowchart TD
    START["Customer opens URL: /t/:token"] --> GET_TOKEN["Backend: GET /api/v1/contacts/token/:token"]
    
    GET_TOKEN --> CHECK_EXISTS{"Token exists & not revoked?"}
    CHECK_EXISTS -- No --> ERR_404["❌ 404: Link Expired or Invalid"]
    CHECK_EXISTS -- Yes --> CHECK_BLOCKED{"Contact blocked?"}
    
    CHECK_BLOCKED -- Yes --> ERR_BLOCKED["🚫 403: Contact Access Blocked"]
    CHECK_BLOCKED -- No --> CHECK_AGENT_STATUS{"Agent deployed & live?"}
    
    CHECK_AGENT_STATUS -- No --> ERR_DRAFT["⏸️ 503: Assistant is Offline (Draft)"]
    CHECK_AGENT_STATUS -- Yes --> CHECK_PIN{"PIN Required?"}
    
    CHECK_PIN -- Yes --> PIN_MODAL["🔒 Display PIN Prompt"] --> VERIFY_PIN{"Verify PIN Hash"}
    VERIFY_PIN -- Invalid --> PIN_ERR["❌ Incorrect PIN"] --> PIN_MODAL
    VERIFY_PIN -- Valid --> BIND_DEVICE
    
    CHECK_PIN -- No --> BIND_DEVICE["📱 Compute Device Fingerprint Hash"]
    
    BIND_DEVICE --> CHECK_BOUND{"Contact already bound to a device?"}
    CHECK_BOUND -- No --> SAVE_BOUND["💾 Save bound_device = fingerprint_hash"] --> LAUNCH_SESSION
    CHECK_BOUND -- Yes --> MATCH_DEVICE{"Does fingerprint match bound_device?"}
    MATCH_DEVICE -- No --> ERR_DEVICE["❌ 403: Link locked to original device"]
    MATCH_DEVICE -- Yes --> LAUNCH_SESSION["🚀 Launch Voice Call & Text Chat View"]
```

---

## 4. Real-Time Bidirectional Voice Call Pipeline

The high-performance voice pipeline streams audio bi-directionally over WebSockets, performing voice activity detection, streaming transcription, temporal grounding, RAG injection, fast LLM inference, and voice synthesis.

```mermaid
sequenceDiagram
    autonumber
    actor Caller as 🎙️ Customer Voice
    participant MicEngine as 🌐 Web Audio API (PCM)
    participant Worker as ⚡ Voice Worker Pipeline
    participant STT as 🎤 Sarvam STT Engine
    participant RAG as 📄 Document Vector Store
    participant LLM as 🧠 Groq LLaMA 3.1 / 3.3
    participant TTS as 🔊 Sarvam TTS Persona Engine
    participant Speaker as 🔊 Customer Speaker
    participant DB as 💾 Sessions & Transcripts DB

    Caller->>MicEngine: Speaks: "What are your opening hours today?"
    MicEngine->>Worker: Stream raw PCM audio packets over WebSocket
    Worker->>Worker: Voice Activity Detection (VAD) detects speech end
    Worker->>STT: Transmit audio buffer to Sarvam STT
    STT-->>Worker: Transcribed text: "What are your opening hours today?"

    Note over Worker, RAG: Live Context & Knowledge Injection
    Worker->>Worker: Inject Live Date/Time context (current_context_line: "Tuesday, 11 August, 04:45 PM")
    Worker->>RAG: Hybrid vector search on uploaded policy documents
    RAG-->>Worker: Retrieve store opening hours snippet

    Note over Worker, LLM: Fast Token Streaming
    Worker->>LLM: Send system prompt + Live context + RAG snippet + User turn
    
    loop Stream Output Tokens
        LLM-->>Worker: Stream text tokens: "We are open until 8:00 PM today..."
    end

    Note over Worker, TTS: Streaming Audio Synthesis
    Worker->>TTS: Stream sentence chunks to Sarvam TTS ("Anushka" persona)
    TTS-->>Worker: Synthesized audio waveform packets
    Worker->>Speaker: Stream binary audio packets to browser AudioContext
    Speaker-->>Caller: Plays natural spoken voice answer

    Note over Worker, DB: Session Logging
    Worker->>DB: Log user query and assistant response to session_turns
    Worker->>DB: Increment contact_sessions.message_count += 2
```

---

## 5. Text Chat & RAG Document Grounding Engine

```mermaid
flowchart TD
    USER_MSG["Customer sends text message"] --> CHAT_ROUTER["FastAPI: /api/v1/chat/message"]
    
    subgraph Ingestion["Document Ingestion Pipeline (Admin Upload)"]
        DOC_UPLOAD["PDF / DOCX / TXT Upload"] --> EXTRACT["Text Extraction"]
        EXTRACT --> CHUNKER["Recursive Text Splitter (500 token chunks)"]
        CHUNKER --> EMBED["Generate Vector Embeddings"]
        EMBED --> VECTOR_DB[("📄 Vector Index")]
    end

    subgraph QueryRAG["Retrieval-Augmented Generation"]
        USER_MSG --> EMBED_QUERY["Embed User Query"]
        EMBED_QUERY --> VECTOR_SEARCH["Vector Similarity Search"]
        VECTOR_DB --> VECTOR_SEARCH
        VECTOR_SEARCH --> TOP_K["Top-3 Document Chunks"]
    end

    subgraph PromptCompilation["Prompt Synthesis"]
        TOP_K --> COMPILE["Compile System Prompt"]
        SYS_PROMPT["Chat Script Prompt"] --> COMPILE
        LIVE_DATE["Live Date & Time Context Line"] --> COMPILE
        COMPILE --> GROQ_LLM["🧠 Groq LLM Inference (LLaMA 3.3 70B)"]
    end

    GROQ_LLM --> STREAM_TEXT["Stream Markdown Response to Customer Chat UI"]
    STREAM_TEXT --> RECORD_DB[("💾 Record Turn in contact_sessions")]
```

---

## 6. Complete Database Schema & Entity-Relationship Model (ERD)

```mermaid
erDiagram
    OWNERS ||--o{ AGENTS : "configures"
    OWNERS ||--o{ CONTACTS : "creates"
    OWNERS ||--o{ DOCUMENTS : "uploads"
    CONTACTS ||--o{ CONTACT_SESSIONS : "conducts"
    CONTACT_SESSIONS ||--o{ SESSION_TURNS : "records"

    OWNERS {
        string tenant_id PK "Primary Key (Hex UUID)"
        string mode "Workspace mode: 'business' | 'personal'"
        string business_name "Public business name (e.g. Shiro art and craft)"
        string business_category "Industry category (e.g. clinic, retail)"
        string email "Owner login email address"
        string password_hash "PBKDF2/Argon2 password hash"
        string groq_key_enc "Encrypted Groq API Key"
        string sarvam_key_enc "Encrypted Sarvam Voice Key"
        string custom_llm_key_enc "Encrypted Custom Provider Key"
        string custom_llm_base_url "Custom Base URL endpoint"
        string llm_model "Selected Default LLM Model"
        datetime mode_chosen_at "Timestamp of setup"
        datetime created_at "Creation timestamp"
        datetime updated_at "Update timestamp"
    }

    AGENTS {
        string tenant_id PK "Foreign Key -> owners.tenant_id"
        string name "Assistant Name (e.g. Asha, Alex)"
        string status "Deployment status: 'deployed' | 'draft'"
        string voice_script "Spoken conversational script for voice calls"
        string chat_script "Structured guideline script for text chat"
        string script "Fallback consolidated script"
        string voice_id "TTS voice speaker persona (e.g. anushka, abhishek)"
        string language "Spoken language code (e.g. unknown, hi-IN, en-IN)"
        boolean rag_enabled "Enable document search on phone calls"
        string greeting "First spoken greeting audio prompt"
        float voice_temperature "Sampling temperature for voice"
        float chat_temperature "Sampling temperature for chat"
        int voice_max_tokens "Maximum output tokens for voice (50-800)"
        int chat_max_tokens "Maximum output tokens for chat (50-4000)"
        datetime deployed_at "Timestamp of deployment"
        datetime created_at "Creation timestamp"
        datetime updated_at "Update timestamp"
    }

    CONTACTS {
        string contact_id PK "Unique Contact ID (UUID)"
        string owner_tenant_id FK "Foreign Key -> owners.tenant_id"
        string name "Caller / Contact Name (e.g. prince)"
        string token "Unique access URL token (Base64 URL-safe)"
        string mode "Allowed channel: 'voice' | 'chat' | 'both'"
        string pin_hash "Optional PIN protection hash"
        string bound_device "Hardware fingerprint hash of first device"
        string note "Internal owner notes"
        boolean blocked "Access blocked toggle"
        boolean revoked "Link revoked toggle"
        datetime last_seen_at "Last active call/chat timestamp"
        datetime created_at "Link creation timestamp"
        datetime updated_at "Update timestamp"
    }

    CONTACT_SESSIONS {
        string session_id PK "Unique Session ID (UUID)"
        string contact_id FK "Foreign Key -> contacts.contact_id"
        string channel "Channel type: 'voice' | 'chat'"
        int message_count "Number of dialogue turns in session"
        string agent_name "Snapshot of agent name at time of call"
        string business_name "Snapshot of business name at time of call"
        string ip_address "Caller IP address"
        string user_agent "Caller browser and device User-Agent"
        datetime started_at "Session start timestamp"
        datetime ended_at "Session end timestamp"
    }

    SESSION_TURNS {
        string turn_id PK "Unique Turn ID"
        string session_id FK "Foreign Key -> contact_sessions.session_id"
        string role "'user' | 'assistant' | 'system'"
        string content "Raw transcribed or generated text"
        datetime created_at "Turn timestamp"
    }

    DOCUMENTS {
        string doc_id PK "Unique Document ID"
        string owner_tenant_id FK "Foreign Key -> owners.tenant_id"
        string filename "Uploaded filename (e.g. pricing_faq.pdf)"
        int file_size "File size in bytes"
        string mime_type "application/pdf, text/plain, etc."
        string content_text "Extracted plain text content"
        datetime uploaded_at "Upload timestamp"
    }
```

---

## 7. Comprehensive Backend API Route Directory

### 🏢 Workspace & Owner Routes (`/api/v1/workspace`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workspace` | Retrieve active workspace profile, business name, and mode | Owner Cookie / Key |
| `POST` | `/api/v1/workspace/mode` | Set workspace mode (`business` vs `personal`) & business name | Owner Cookie / Key |
| `PUT` | `/api/v1/workspace/profile` | Update business name and business category | Owner Cookie / Key |
| `GET` | `/api/v1/workspace/providers` | Retrieve encrypted API key status and default LLM model | Owner Cookie / Key |
| `PUT` | `/api/v1/workspace/providers` | Encrypt and save Groq, Sarvam, and Custom Provider keys | Owner Cookie / Key |
| `POST` | `/api/v1/workspace/credentials` | Update owner login email and set console password | Owner Cookie / Key |
| `GET` | `/api/v1/workspace/categories` | List available business category presets | Public / Owner |
| `GET` | `/api/v1/workspace/agent` | Retrieve assistant configuration, prompts, and voice | Owner Cookie / Key |
| `PUT` | `/api/v1/workspace/agent` | Update assistant voice/chat scripts, model, and persona | Owner Cookie / Key |
| `POST` | `/api/v1/workspace/agent/deploy` | Make assistant **Live** (enables calls from directory and links) | Owner Cookie / Key |
| `POST` | `/api/v1/workspace/agent/undeploy` | Take assistant **Offline (Draft)** | Owner Cookie / Key |
| `DELETE`| `/api/v1/workspace/agent` | Reset assistant prompts and voice back to fresh defaults | Owner Cookie / Key |
| `GET` | `/api/v1/workspace/channels` | Check readiness of Voice and Chat channels | Owner Cookie / Key |
| `POST` | `/api/v1/workspace/logout` | Clear owner session cookie and sign out | Owner Cookie |

---

### 👥 Contacts & Calls Routes (`/api/v1/contacts`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/contacts` | List all unique contacts with session counts and device status | Owner Cookie / Key |
| `POST` | `/api/v1/contacts` | Generate a new access link with name, PIN, and allowed mode | Owner Cookie / Key |
| `GET` | `/api/v1/contacts/overview` | Dashboard metrics totals and recent completed conversations | Owner Cookie / Key |
| `POST` | `/api/v1/contacts/:id/rotate` | Revoke old token and issue fresh token (resets device binding) | Owner Cookie / Key |
| `POST` | `/api/v1/contacts/:id/block` | Block or unblock caller access | Owner Cookie / Key |
| `DELETE`| `/api/v1/contacts/:id` | Delete contact profile and all associated call transcripts | Owner Cookie / Key |
| `GET` | `/api/v1/contacts/:id/sessions` | List all completed conversation sessions for a specific caller | Owner Cookie / Key |
| `GET` | `/api/v1/contacts/:id/transcript`| Retrieve full turn-by-turn dialogue transcript for a session | Owner Cookie / Key |
| `GET` | `/api/v1/contacts/token/:token` | Validate access link, check PIN, and bind device fingerprint | Caller Token |

---

### 🌐 Public Directory Routes (`/api/v1/directory`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/directory` | List all public businesses with live deployed assistants | Public |
| `POST` | `/api/v1/directory/connect` | Smart connect: reuses existing contact for caller or creates new | Public |

---

### 🎙️ Voice & Document Routes (`/api/v1/voice`, `/api/v1/documents`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/voice/speakers` | Catalogue of Sarvam voice personas (male & female) | Public / Owner |
| `GET` | `/api/v1/voice/languages`| List of supported languages for speech recognition & TTS | Public / Owner |
| `POST` | `/api/v1/voice/preview` | Generate instant audio sample for a speaker persona | Owner Cookie / Key |
| `WS` | `/api/v1/voice/stream` | Real-time bidirectional WebSocket audio streaming pipeline | Caller / Token |
| `GET` | `/api/v1/documents` | List uploaded RAG knowledge documents | Owner Cookie / Key |
| `POST` | `/api/v1/documents` | Upload and chunk PDF/DOCX/TXT knowledge file | Owner Cookie / Key |
| `DELETE`| `/api/v1/documents/:id` | Remove document from RAG index | Owner Cookie / Key |
