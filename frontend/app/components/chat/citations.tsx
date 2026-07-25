"use client";

// Turning `[1.2]` markers in model output into clickable source chips.
//
// Extracted from the page component because this is the product's signature
// behaviour — an answer you can verify — and it deserves to be readable and
// testable on its own rather than buried in a 3,700-line file.

import React from "react";

import type { Citation } from "../../lib/api";

// Matches [1.2], [1], and the legacy [Source 1.2] / [Source 1] forms.
const CITATION_PATTERN = /\[(?:Source\s*)?(\d+(?:\.\d+)?)\]/gi;

export type CitationOpener = (citation: Citation, label: string) => void;

/** Resolve a marker label to the citation it refers to.
 *
 *  Hierarchical ids (`1.2` = document 1, chunk 2) match `display_number`.
 *  A bare `1` is the older flat format and falls back to positional lookup. */
export function resolveCitation(
  label: string,
  citations: Citation[]
): Citation | undefined {
  const byDisplay = citations.find((c) => c.display_number === label);
  if (byDisplay) return byDisplay;
  if (!label.includes(".")) return citations[Number.parseInt(label, 10) - 1];
  return undefined;
}

/**
 * Split text into plain segments and citation chips.
 *
 * The two miss cases are deliberately different:
 * - Citations have arrived but this marker matches none of them: the model
 *   invented an id. Drop it, rather than leaving a dead "[1.5]" in the prose.
 * - No citations yet (still streaming): keep the raw marker so text isn't
 *   silently mangled mid-stream, then it resolves when the list lands.
 */
export function renderWithCitations(
  text: string,
  citations: Citation[],
  onOpen: CitationOpener
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  // Reset: the regex is module-level and `lastIndex` persists between calls.
  CITATION_PATTERN.lastIndex = 0;

  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const label = match[1];
    const citation = resolveCitation(label, citations);

    if (citation) {
      parts.push(
        <CitationChip
          key={`cite-${key++}`}
          label={label}
          citation={citation}
          onOpen={onOpen}
        />
      );
    } else if (citations.length === 0) {
      parts.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/** Walk rendered markdown children, splicing chips into string nodes only —
 *  so markers inside code blocks and links are left alone. */
export function processChildren(
  children: React.ReactNode,
  citations: Citation[],
  onOpen: CitationOpener
): React.ReactNode {
  if (citations.length === 0) return children;

  const out: React.ReactNode[] = [];
  React.Children.forEach(children, (child, index) => {
    if (typeof child === "string") {
      out.push(
        <React.Fragment key={`seg-${index}`}>
          {renderWithCitations(child, citations, onOpen)}
        </React.Fragment>
      );
    } else {
      out.push(child);
    }
  });
  return out;
}

export function CitationChip({
  label,
  citation,
  onOpen,
}: {
  label: string;
  citation: Citation;
  onOpen: CitationOpener;
}) {
  const source = citation.page_number
    ? `${citation.filename} · p.${citation.page_number}`
    : citation.filename;

  return (
    <button
      type="button"
      className="citation-chip ds-pressable"
      onClick={() => onOpen(citation, label)}
      // Hover was previously applied by mutating style in JS handlers, which
      // skips CSS transitions and leaves the chip stuck mid-state if the
      // pointer leaves during a re-render.
      title={`${source} — click to view source`}
      aria-label={`Source ${label}: ${source}`}
    >
      {label}
    </button>
  );
}
