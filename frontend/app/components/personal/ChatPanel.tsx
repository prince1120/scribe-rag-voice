"use client";

import React, { memo } from "react";
import { ArrowDown, ChevronDown, ListFilter, Menu, Phone, Settings } from "lucide-react";
import { ScribeMark } from "../../Logo";
import { Message as ChatMessageView } from "../chat/Message";
import { Composer } from "./Composer";
import type { ChatMessage, StreamingState, ChatImage } from "../../hooks/useChat";
import type { Citation } from "../../lib/api";

interface ChatPanelProps {
  documentsLength: number;
  messages: ChatMessage[];
  streaming: StreamingState | null;
  isLoading: boolean;
  input: string;
  setInput: (v: string) => void;
  chatImages: ChatImage[];
  dragOverComposer: boolean;
  setDragOverComposer: (v: boolean) => void;
  showScrollBottom: boolean;
  activeQuestionId: string;
  questionIndexOpen: boolean;
  setQuestionIndexOpen: (v: boolean) => void;
  setActiveQuestionId: (id: string) => void;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  chatImageInputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (e?: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onChatScroll: () => void;
  onOpenSource: (citation: Citation, label: string) => void;
  onOpenVoice: () => void;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
  addChatImages: (files: FileList | File[]) => void;
  removeChatImage: (id: string) => void;
  onComposerDrop: (e: React.DragEvent) => void;
  onComposerPaste: (e: React.ClipboardEvent) => void;
  hasVoiceKey?: boolean;
}

// Memoized row so completed messages do not re-render during streaming ticks.
const MessageRow = memo(function MessageRow({
  message,
  streaming,
  onOpenSource,
}: {
  message: ChatMessage;
  streaming: boolean;
  onOpenSource: (citation: Citation, label: string) => void;
}) {
  return (
    <ChatMessageView
      message={{
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.annotations,
        images: message.images,
        metrics: message.metrics,
        streaming,
      }}
      onOpenCitation={onOpenSource}
    />
  );
});

const StreamingBubble = memo(function StreamingBubble({
  streaming,
  onOpenSource,
}: {
  streaming: StreamingState;
  onOpenSource: (citation: Citation, label: string) => void;
}) {
  return (
    <ChatMessageView
      message={{
        id: streaming.id,
        role: "assistant" as const,
        content: streaming.content,
        citations: streaming.citations,
        metrics: streaming.metrics,
        streaming: true,
      }}
      onOpenCitation={onOpenSource}
    />
  );
});

const SUGGESTIONS = [
  "Summarize the key points",
  "What are the main conclusions?",
  "List the important dates and figures",
  "Compare the documents",
];

export function ChatPanel(props: ChatPanelProps) {
  const {
    documentsLength,
    messages,
    streaming,
    isLoading,
    input,
    setInput,
    chatImages,
    dragOverComposer,
    setDragOverComposer,
    showScrollBottom,
    activeQuestionId,
    questionIndexOpen,
    setQuestionIndexOpen,
    setActiveQuestionId,
    chatScrollRef,
    messagesEndRef,
    textareaRef,
    chatImageInputRef,
    onSubmit,
    onKeyDown,
    onChatScroll,
    onOpenSource,
    onOpenVoice,
    onOpenSettings,
    onOpenSidebar,
    addChatImages,
    removeChatImage,
    onComposerDrop,
    onComposerPaste,
    hasVoiceKey,
  } = props;

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <header
        className="h-16 px-4 sm:px-6 border-b flex items-center justify-between gap-2"
        style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open menu"
            className="md:hidden w-9 h-9 -ml-1 rounded-md inline-flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ color: "var(--claude-text-2)" }}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col justify-center leading-tight min-w-0">
            <h2 className="font-serif-display text-[19px] leading-tight tracking-tight truncate" style={{ color: "var(--claude-text)" }}>
              Conversation
            </h2>
            <p className="text-[11px] leading-tight mt-0.5" style={{ color: "var(--claude-muted)" }}>
              {documentsLength > 0 ? `Grounded in ${documentsLength} source${documentsLength === 1 ? "" : "s"}` : "Upload a document to get started"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 relative">
          {messages.filter((m) => m.role === "user").length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setQuestionIndexOpen(!questionIndexOpen)}
                title="Jump to any question in session"
                className="text-[11px] h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full border transition-colors cursor-pointer"
                style={{
                  borderColor: questionIndexOpen ? "var(--claude-accent)" : "var(--claude-border)",
                  color: questionIndexOpen ? "var(--claude-accent)" : "var(--claude-text-2)",
                  background: questionIndexOpen ? "var(--claude-accent-soft)" : "var(--claude-surface)",
                }}
              >
                <ListFilter className="w-3 h-3 text-[var(--claude-accent)]" />
                <span>
                  {(() => {
                    const userMsgs = messages.filter((m) => m.role === "user");
                    const activeIdx = userMsgs.findIndex((m) => m.id === activeQuestionId);
                    return activeIdx >= 0 ? `Q${activeIdx + 1} of ${userMsgs.length}` : `${userMsgs.length} question${userMsgs.length === 1 ? "" : "s"}`;
                  })()}
                </span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {questionIndexOpen && (
                <div
                  className="absolute right-0 top-9 z-50 w-72 max-h-[380px] overflow-y-auto rounded-2xl border shadow-xl p-3 space-y-2 msg-enter backdrop-blur-xl"
                  style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border-strong)", boxShadow: "0 12px 36px rgba(0, 0, 0, 0.14)" }}
                >
                  <div className="flex items-center justify-between border-b pb-2 px-1" style={{ borderColor: "var(--claude-border)" }}>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-[var(--claude-muted)]">
                      <ListFilter className="w-3.5 h-3.5 text-[var(--claude-accent)]" />
                      <span>Timeline Outline</span>
                    </div>
                    <span className="text-[10px] text-[var(--claude-muted)] font-mono">
                      {messages.filter((m) => m.role === "user").length} questions
                    </span>
                  </div>
                  <div className="relative pl-7 space-y-2.5 pt-1.5 pb-1.5 before:absolute before:left-[11px] before:top-4 before:bottom-4 before:w-[2px] before:bg-[var(--claude-border)]">
                    {messages
                      .filter((m) => m.role === "user")
                      .map((m, idx, userMsgs) => {
                        const activeIdx = userMsgs.findIndex((msg) => msg.id === activeQuestionId);
                        const isActive = m.id === activeQuestionId || (activeIdx === -1 && idx === userMsgs.length - 1);
                        const msgIdx = messages.findIndex((msg) => msg.id === m.id);
                        const assistantMsg = msgIdx >= 0 ? messages[msgIdx + 1] : null;
                        const citationCount = assistantMsg?.annotations?.length || 0;
                        return (
                          <div key={m.id} className="relative group">
                            <div
                              className={`absolute left-[-22px] top-3.5 w-3 h-3 rounded-full border transition-all ${
                                isActive
                                  ? "bg-[var(--claude-accent)] border-[var(--claude-accent)] scale-110 ring-4 ring-[var(--claude-accent-soft)] z-10"
                                  : "bg-[var(--claude-surface)] border-[var(--claude-border-strong)] group-hover:border-[var(--claude-accent)] z-10"
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setActiveQuestionId(m.id);
                                setQuestionIndexOpen(false);
                                const el = document.getElementById(`msg-${m.id}`);
                                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                              }}
                              className={`w-full text-left p-2.5 rounded-xl text-[12px] transition-all cursor-pointer border ${
                                isActive
                                  ? "bg-[var(--claude-accent-soft)] border-[var(--claude-accent)] font-medium shadow-sm"
                                  : "hover:bg-[var(--claude-surface-2)] border-transparent"
                              }`}
                              style={{ color: "var(--claude-text)" }}
                            >
                              <div className="flex items-center justify-between text-[10px] text-[var(--claude-muted)] mb-0.5 font-semibold">
                                <span className={isActive ? "text-[var(--claude-accent)] font-bold" : ""}>Question {idx + 1}</span>
                                {citationCount > 0 && (
                                  <span className="bg-[var(--claude-surface)] px-1.5 py-0.2 rounded border text-[9px]" style={{ borderColor: "var(--claude-border)" }}>
                                    {citationCount} src{citationCount === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>
                              <p className="line-clamp-2 leading-snug">{m.content || "Attached image question"}</p>
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (hasVoiceKey === false) {
                onOpenSettings();
                return;
              }
              onOpenVoice();
            }}
            title={hasVoiceKey === false ? "Add Sarvam key in Settings to enable voice" : "Start a voice call"}
            aria-label="Voice call"
            className={`w-7 h-7 rounded-full border inline-flex items-center justify-center transition-colors ${hasVoiceKey === false ? "opacity-60" : ""}`}
            style={{
              borderColor: "var(--claude-border)",
              color: "var(--claude-muted)",
              background: hasVoiceKey === false ? "var(--claude-surface-2)" : "var(--claude-surface)",
            }}
            onMouseEnter={(e) => {
              if (hasVoiceKey === false) {
                e.currentTarget.style.borderColor = "var(--claude-accent)";
                return;
              }
              e.currentTarget.style.color = "var(--claude-accent)";
              e.currentTarget.style.borderColor = "var(--claude-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--claude-muted)";
              e.currentTarget.style.borderColor = "var(--claude-border)";
            }}
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="RAG & generation settings"
            aria-label="Settings"
            className="w-7 h-7 rounded-full border inline-flex items-center justify-center transition-colors"
            style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)", background: "var(--claude-surface)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--claude-accent)";
              e.currentTarget.style.borderColor = "var(--claude-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--claude-muted)";
              e.currentTarget.style.borderColor = "var(--claude-border)";
            }}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {hasVoiceKey === false && (
        <div className="px-4 sm:px-6 py-2 text-xs flex items-center justify-between gap-2 border-b" style={{ background: "var(--claude-accent-soft)", borderColor: "var(--claude-border)", color: "var(--claude-text-2)" }}>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--claude-accent)" }} />
            Voice calls need Sarvam key — add in Settings to enable.
          </span>
          <button type="button" onClick={onOpenSettings} className="text-xs font-semibold underline shrink-0" style={{ color: "var(--claude-accent)" }}>
            Add key →
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto relative ds-scroll" ref={chatScrollRef} onScroll={onChatScroll} style={{ overscrollBehaviorY: "contain" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center text-center pt-20 pb-10">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6" style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}>
                <ScribeMark className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-serif-display text-[34px] leading-tight tracking-tight mb-3" style={{ color: "var(--claude-text)" }}>
                How can I help you today?
              </h2>
              <p className="text-[14px] leading-relaxed max-w-md mb-6" style={{ color: "var(--claude-muted)" }}>
                Ask anything about your uploaded documents. I&apos;ll respond with citations so you can verify every claim.
              </p>
              {documentsLength === 0 && (
                <div className="w-full max-w-xl mb-8 rounded-xl border p-4 flex items-center gap-3 text-left" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", boxShadow: "var(--shadow-sm)" }}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--claude-accent-soft)", color: "var(--claude-accent)" }}>
                    <span className="text-sm font-bold">↑</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold" style={{ color: "var(--claude-text)" }}>Upload a document to get started</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--claude-muted)" }}>PDF, DOCX, CSV or image — then ask. Your first answer will be grounded.</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    disabled={documentsLength === 0}
                    onClick={() => {
                      setInput(s);
                      // Focus the textarea after setting suggestion
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                    className="ds-lift text-left px-4 py-3 rounded-xl border text-[13px] leading-snug transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-text-2)" }}
                    onMouseEnter={(e) => {
                      if (documentsLength === 0) return;
                      e.currentTarget.style.background = "var(--claude-accent-soft)";
                      e.currentTarget.style.borderColor = "var(--claude-accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--claude-surface)";
                      e.currentTarget.style.borderColor = "var(--claude-border)";
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="msg-list-inner">
            {messages.map((message) => (
              <div key={message.id} id={`msg-${message.id}`} className="scroll-mt-6">
                <MessageRow message={message} streaming={false} onOpenSource={onOpenSource} />
              </div>
            ))}
            {streaming && (
              <div id={`msg-${streaming.id}`} className="scroll-mt-6">
                <StreamingBubble streaming={streaming} onOpenSource={onOpenSource} />
              </div>
            )}
            {isLoading && !streaming && (
              <div className="flex items-center gap-2 py-4 text-[13px]" style={{ color: "var(--claude-muted)" }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--claude-accent)" }} />
                Checking knowledge base — answering immediately…
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t relative" style={{ borderColor: "var(--claude-border)", background: "var(--claude-cream)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {showScrollBottom && (messages.length > 0 || !!streaming) && (
          <button
            type="button"
            onClick={() => {
              const el = chatScrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            aria-label="Scroll to bottom"
            title="Jump to latest message"
            className="absolute -top-11 right-4 sm:right-6 z-40 h-8 px-3 rounded-full shadow-md border inline-flex items-center gap-1.5 text-[11px] font-medium transition-all transform hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-md"
            style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border-strong)", color: "var(--claude-text)", boxShadow: "0 4px 14px rgba(0,0,0,0.12)" }}
          >
            <ArrowDown className="w-3.5 h-3.5 text-[var(--claude-accent)] flex-shrink-0" />
            <span>Jump to bottom</span>
          </button>
        )}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <Composer
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            documentsLength={documentsLength}
            chatImages={chatImages}
            dragOverComposer={dragOverComposer}
            setDragOverComposer={setDragOverComposer}
            textareaRef={textareaRef}
            chatImageInputRef={chatImageInputRef}
            onKeyDown={onKeyDown}
            onSubmit={onSubmit}
            onComposerDrop={onComposerDrop}
            onComposerPaste={onComposerPaste}
            addChatImages={addChatImages}
            removeChatImage={removeChatImage}
          />
        </div>
      </div>
    </main>
  );
}
