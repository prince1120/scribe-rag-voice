"use client";

// A single turn in the conversation.
//
// User turns are a compact bubble; assistant turns are full-width prose. That
// asymmetry is deliberate — bubbling both sides makes a long grounded answer
// read like a text message, which undercuts the idea that it is something you
// check rather than skim.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Citation } from "../../lib/api";
import { type CitationOpener, processChildren } from "./citations";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  error?: string | null;
  streaming?: boolean;
}

export function ThinkingIndicator() {
  return (
    <div className="msg-thinking" role="status" aria-label="Thinking">
      <span className="ds-thinking-dot" />
      <span className="ds-thinking-dot" />
      <span className="ds-thinking-dot" />
    </div>
  );
}

function MarkdownAnswer({
  content,
  citations,
  onOpenCitation,
}: {
  content: string;
  citations: Citation[];
  onOpenCitation: CitationOpener;
}) {
  // Every text-bearing element routes its children through processChildren so
  // a marker is turned into a chip wherever it appears in the prose.
  const withCitations = (children: React.ReactNode) =>
    processChildren(children, citations, onOpenCitation);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p>{withCitations(children)}</p>,
        li: ({ children }) => <li>{withCitations(children)}</li>,
        h1: ({ children }) => <h2>{withCitations(children)}</h2>,
        h2: ({ children }) => <h2>{withCitations(children)}</h2>,
        h3: ({ children }) => <h3>{withCitations(children)}</h3>,
        td: ({ children }) => <td>{withCitations(children)}</td>,
        strong: ({ children }) => <strong>{withCitations(children)}</strong>,
        // Code is left untouched: a "[1]" inside a snippet is code, not a
        // citation, and turning it into a button would corrupt the sample.
        code: ({ children, ...props }) => <code {...props}>{children}</code>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function Message({
  message,
  onOpenCitation,
  onRetry,
}: {
  message: ChatMessage;
  onOpenCitation: CitationOpener;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user ds-animate-rise">
        <div className="msg-user-bubble">{message.content}</div>
      </div>
    );
  }

  const isEmpty = !message.content.trim();

  return (
    <div className="msg msg-assistant ds-animate-rise">
      <div
        className="msg-body"
        // Streaming text is announced politely so a screen reader user hears
        // the answer as it lands instead of nothing at all.
        aria-live={message.streaming ? "polite" : undefined}
      >
        {isEmpty && message.streaming ? (
          <ThinkingIndicator />
        ) : (
          <>
            <MarkdownAnswer
              content={message.content}
              citations={message.citations ?? []}
              onOpenCitation={onOpenCitation}
            />
            {message.streaming && <span className="ds-caret" aria-hidden="true" />}
          </>
        )}

        {message.error && (
          <div className="msg-error" role="alert">
            <span>{message.error}</span>
            {onRetry && (
              <button type="button" className="msg-retry ds-pressable" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sources are listed under the answer as well as inline, so they can be
          scanned without hunting for chips in the prose. */}
      {!message.streaming && (message.citations?.length ?? 0) > 0 && (
        <div className="msg-sources">
          <span className="msg-sources-label">Sources</span>
          <div className="msg-sources-list">
            {message.citations!.map((citation) => (
              <button
                key={citation.chunk_id}
                type="button"
                className="source-pill ds-pressable ds-tap"
                onClick={() =>
                  onOpenCitation(citation, citation.display_number ?? "")
                }
                title={citation.snippet}
              >
                <span className="source-pill-num">{citation.display_number}</span>
                <span className="source-pill-name">{citation.filename}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
