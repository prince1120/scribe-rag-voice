"use client";

// A single turn in the conversation.
//
// User turns are a compact bubble; assistant turns are full-width prose. That
// asymmetry is deliberate — bubbling both sides makes a long grounded answer
// read like a text message, which undercuts the idea that it is something you
// check rather than skim.

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Citation } from "../../lib/api";
import { type CitationOpener, processChildren } from "./citations";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** Data URLs for images the user attached to their own turn. */
  images?: string[];
  error?: string | null;
  streaming?: boolean;
}

// Must stay in sync with the pattern in citations.tsx — this one answers a
// different question ("which sources did the model actually reference?") so it
// counts markers rather than replacing them.
const MARKER_PATTERN = /\[(?:Source\s*)?(\d+(?:\.\d+)?)\]/gi;

/** Only the citations the answer actually cites.
 *
 *  Retrieval returns the top-k chunks, but the model may use two of five.
 *  Listing all five implies evidence the answer never leaned on, which is
 *  exactly the kind of overstated grounding this product should avoid. */
function referencedCitations(content: string, citations: Citation[]): Citation[] {
  if (citations.length === 0) return [];

  const used = new Set<string>();
  MARKER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_PATTERN.exec(content)) !== null) used.add(match[1]);

  // No markers at all (a refusal, or small talk) means nothing to show —
  // rather than falling back to listing every retrieved chunk.
  if (used.size === 0) return [];

  return citations.filter((citation, index) => {
    if (citation.display_number && used.has(citation.display_number)) return true;
    // Flat "[1]" markers from the older format resolve positionally.
    return used.has(String(index + 1));
  });
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    // Cleared on unmount so a message removed mid-timeout doesn't set state
    // on a gone component.
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access is denied on insecure origins and some browsers.
      // Failing silently is right here — there is nothing the user can do,
      // and an error toast for a copy button is worse than nothing.
    }
  }

  return (
    <button
      type="button"
      className="msg-copy ds-pressable"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy response"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
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
        <div className="msg-user-bubble">
          {(message.images?.length ?? 0) > 0 && (
            <div className={`msg-attachments ${message.content ? "has-text" : ""}`}>
              {message.images!.map((src, index) => (
                <button
                  key={index}
                  type="button"
                  className="msg-attachment ds-pressable"
                  onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
                  title="Open full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Attachment ${index + 1}`} />
                </button>
              ))}
            </div>
          )}
          {message.content && <p className="msg-user-text">{message.content}</p>}
        </div>
      </div>
    );
  }

  const isEmpty = !message.content.trim();
  const sources = referencedCitations(message.content, message.citations ?? []);

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

      {!message.streaming && message.content.trim() && (
        <div className="msg-toolbar">
          <CopyButton text={message.content} />
        </div>
      )}

      {/* Sources are listed under the answer as well as inline, so they can be
          scanned without hunting for chips in the prose. */}
      {!message.streaming && sources.length > 0 && (
        <div className="msg-sources">
          <span className="msg-sources-label">Sources</span>
          <div className="msg-sources-list">
            {sources.map((citation) => (
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
