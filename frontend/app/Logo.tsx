/** Scribe's brand mark — a quill nib, not a generic "AI sparkle" icon.
 * Ties directly to the name ("Scribe" = one who writes/transcribes) and the
 * manuscript-beige/serif brand language, instead of the stock icon nearly
 * every AI chat app reaches for. Drawn at the same 24x24 / stroke-based
 * convention as the lucide icons used elsewhere, so it sits consistently
 * alongside them wherever both appear.
 */
export function ScribeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Refined quill nib body */}
      <path
        d="M12 2C10.5 4.5 9 7.5 9 10C9 13.5 11 15 12 17C13 15 15 13.5 15 10C15 7.5 13.5 4.5 12 2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
      {/* Center slit */}
      <path
        d="M12 2V12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Breather hole */}
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      {/* Bottom ink/wave line */}
      <path
        d="M7 21C9.5 19.5 14.5 19.5 17 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
