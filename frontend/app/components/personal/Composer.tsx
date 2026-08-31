"use client";

import { Image as ImageIcon, Loader2, Paperclip, Send, X } from "lucide-react";
import type { ChatImage } from "../../hooks/useChat";

interface ComposerProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  documentsLength: number;
  chatImages: ChatImage[];
  dragOverComposer: boolean;
  setDragOverComposer: (value: boolean) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  chatImageInputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onComposerDrop: (e: React.DragEvent) => void;
  onComposerPaste: (e: React.ClipboardEvent) => void;
  addChatImages: (files: FileList | File[]) => void;
  removeChatImage: (id: string) => void;
}

export function Composer({
  input,
  setInput,
  isLoading,
  documentsLength,
  chatImages,
  dragOverComposer,
  setDragOverComposer,
  textareaRef,
  chatImageInputRef,
  onKeyDown,
  onSubmit,
  onComposerDrop,
  onComposerPaste,
  addChatImages,
  removeChatImage,
}: ComposerProps) {
  return (
    <form onSubmit={onSubmit}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOverComposer) setDragOverComposer(true);
        }}
        onDragLeave={() => setDragOverComposer(false)}
        onDrop={onComposerDrop}
        className="rounded-2xl border transition-all relative focus-within:border-[var(--claude-accent)] focus-within:shadow-[0_0_0_3px_var(--claude-accent-soft)] has-[textarea:focus]:border-[var(--claude-accent)]"
        style={{
          borderColor: dragOverComposer ? "var(--claude-accent)" : "var(--claude-border-strong)",
          background: dragOverComposer ? "var(--claude-accent-soft)" : "var(--claude-surface)",
          boxShadow: dragOverComposer ? "0 0 0 3px var(--claude-accent-soft)" : "var(--shadow-sm)",
        }}
      >
        {chatImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {chatImages.map((img) => (
              <div
                key={img.id}
                className="relative group"
                style={{ width: 64, height: 64, borderRadius: 10, overflow: "hidden", border: "1px solid var(--claude-border)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button
                  type="button"
                  onClick={() => removeChatImage(img.id)}
                  aria-label="Remove image"
                  className="absolute top-1 right-1 w-5 h-5 rounded-full inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(20,20,18,0.75)", color: "white" }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 pl-3 pr-2 py-2">
          <button
            type="button"
            onClick={() => chatImageInputRef.current?.click()}
            aria-label="Attach image"
            title="Attach image (or drag/drop, or paste)"
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
            style={{ color: "var(--claude-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--claude-surface-2)";
              e.currentTarget.style.color = "var(--claude-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--claude-muted)";
            }}
            disabled={isLoading || chatImages.length >= 3}
          >
            <Paperclip className="w-[18px] h-[18px]" strokeWidth={2} />
          </button>
          <input
            ref={chatImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addChatImages(e.target.files);
              e.target.value = "";
            }}
          />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onComposerPaste}
            placeholder={
              documentsLength === 0 && chatImages.length === 0
                ? "Upload a document or drop an image to start chatting…"
                : chatImages.length > 0
                  ? "Ask about the attached image…"
                  : "Ask a question, or drop an image here…"
            }
            rows={1}
            className="flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-[var(--claude-muted)] disabled:cursor-not-allowed"
            style={{ color: "var(--claude-text)" }}
            disabled={isLoading}
          />
          {(() => {
            const canSend = !isLoading && (input.trim().length > 0 || chatImages.length > 0) && (documentsLength > 0 || chatImages.length > 0);
            return (
              <button
                type="submit"
                disabled={!canSend}
                className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed flex-shrink-0"
                style={{ background: canSend ? "var(--claude-accent)" : "var(--claude-border-strong)", color: "white" }}
                onMouseEnter={(e) => {
                  if (canSend) e.currentTarget.style.background = "var(--claude-accent-hover)";
                }}
                onMouseLeave={(e) => {
                  if (canSend) e.currentTarget.style.background = "var(--claude-accent)";
                }}
                aria-label="Send message"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={2.25} />}
              </button>
            );
          })()}
        </div>

        {dragOverComposer && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
            style={{ background: "var(--claude-accent-soft)", color: "var(--claude-accent-hover)" }}
          >
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <ImageIcon className="w-5 h-5" />
              Drop image to attach
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-center mt-2.5 leading-none" style={{ color: "var(--claude-muted)" }}>
        {documentsLength === 0 && chatImages.length === 0
          ? "Upload a document or drop an image to start chatting."
          : "Enter to send · Shift+Enter newline · drag/drop or paste images (max 3)"}
      </p>
    </form>
  );
}
