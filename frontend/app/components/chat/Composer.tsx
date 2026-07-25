"use client";

// The message input.
//
// Anchored to the bottom on mobile with safe-area padding, because a composer
// that sits above the home indicator is the single most common way a chat UI
// gives itself away as untested on a phone.

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_ROWS_HEIGHT = 200;

export function Composer({
  onSend,
  onStop,
  onStartVoice,
  busy = false,
  disabled = false,
  placeholder = "Ask about your documents…",
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  onStartVoice?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to a ceiling, then scroll. Height is reset to "auto"
  // first because scrollHeight never shrinks below the current height.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_HEIGHT)}px`;
  }, []);

  useEffect(resize, [value, resize]);

  function submit() {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue("");
    // Refocus so a follow-up question needs no click — but only on a pointer
    // device: forcing focus on mobile reopens the keyboard over the answer
    // the user just asked for.
    if (window.matchMedia("(pointer: fine)").matches) {
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. On touch devices Enter always
    // inserts a newline — there is no Shift key, and the send button is right
    // there.
    if (event.key !== "Enter" || event.shiftKey) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="composer-wrap ds-safe-bottom">
      <div className="composer">
        <textarea
          ref={textareaRef}
          className="composer-input ds-scroll"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message"
        />

        <div className="composer-actions">
          {onStartVoice && (
            <button
              type="button"
              className="composer-btn composer-btn-ghost ds-pressable ds-tap"
              onClick={onStartVoice}
              disabled={disabled}
              title="Start a voice conversation"
              aria-label="Start a voice conversation"
            >
              <MicIcon />
            </button>
          )}

          {busy && onStop ? (
            <button
              type="button"
              className="composer-btn composer-btn-stop ds-pressable ds-tap"
              onClick={onStop}
              title="Stop generating"
              aria-label="Stop generating"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className="composer-btn composer-btn-send ds-pressable ds-tap"
              onClick={submit}
              disabled={!value.trim() || disabled}
              title="Send"
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>

      <p className="composer-hint">
        Answers cite your documents. Check the sources for anything important.
      </p>
    </div>
  );
}

/* Inline SVGs rather than an icon package: three glyphs do not justify a
   dependency, and these inherit currentColor so they follow every theme and
   state change for free. */

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 12h15M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
