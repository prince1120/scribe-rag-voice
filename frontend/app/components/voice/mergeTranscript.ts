type Line = { id: string; role: string; text: string };
type Group<T> = T & { speechParts?: { id: string; text: string }[] };

// ASR finals are speech segments, not necessarily complete conversational turns.
export function mergeTranscript<T extends Line>(previous: T[], segment: T): T[] {
  if (!segment.text.trim()) return previous;
  const next = [...previous] as Group<T>[];
  let index = next.findIndex(item => item.id === segment.id ||
    item.speechParts?.some(part => part.id === segment.id));
  if (index < 0 && segment.role === "user" && next.at(-1)?.role === "user") index = next.length - 1;
  if (index < 0) return [...next, segment];
  const current = next[index];
  if (segment.role !== "user") { next[index] = segment; return next; }
  const parts = [...(current.speechParts ?? [{ id: current.id, text: current.text }])];
  const partIndex = parts.findIndex(part => part.id === segment.id);
  if (partIndex < 0) parts.push({ id: segment.id, text: segment.text });
  else parts[partIndex] = { id: segment.id, text: segment.text };
  next[index] = { ...current, ...segment, id: current.id, speechParts: parts,
    text: parts.map(part => part.text.trim()).join(" ") };
  return next;
}
