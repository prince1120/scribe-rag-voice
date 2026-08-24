/** Sanitize user input before sending to LLM — tiny helper. */

export function sanitizeQuery(input: string): string {
  if (!input) return "";
  // NFKC, strip zero-width, collapse whitespace
  let t = input.normalize("NFKC");
  t = t.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  t = t.replace(/\s+/g, " ").trim();
  // cap length
  if (t.length > 4000) t = t.slice(0, 4000);
  return t;
}
