// Visual identity per voice.
//
// Each Sarvam voice already ships with a character in its tagline — "Deep &
// Authoritative", "Gentle & Soothing", "Bright & Warm". The orb ignored all of
// it and rendered one indigo blob regardless, so picking a voice changed what
// you heard and nothing you saw.
//
// Colour is derived from character, not from gender: tying hue to male/female
// would encode "pink for women, blue for men", which is both crude and useless
// as information — Kabir (cinematic) and Roopa (soothing) differ far more
// meaningfully than any two voices of the same gender do. Gender still informs
// the agent's own speech (verb conjugation, see voice/config.py); it does not
// need to drive the colour.
//
// Hues stay within the warm, muted range the rest of the product uses. Nothing
// neon: this sits behind a conversation and must not compete with it.

export interface VoicePersona {
  /** Core orb colour. */
  core: string;
  /** Secondary colour for the drifting blobs inside the orb. */
  accent: string;
  /** Seconds per breathing cycle. Calm voices breathe slowly. */
  breathe: number;
  /** Multiplier on the blob drift speed. */
  drift: number;
}

// Fallback, and what an unrecognised or unset voice gets: the product's own
// indigo, so the orb is never uncoloured.
export const DEFAULT_PERSONA: VoicePersona = {
  core: "#4854A8",
  accent: "#7C86C8",
  breathe: 4.5,
  drift: 1,
};

const PERSONAS: Record<string, VoicePersona> = {
  // --- Male voices ---------------------------------------------------------
  // Confident & Bold — saturated indigo, brisk.
  shubh: { core: "#4A56B0", accent: "#8A93D8", breathe: 3.8, drift: 1.15 },
  // Deep & Authoritative — dark slate-blue, slow and heavy.
  rahul: { core: "#3B4A6B", accent: "#6E82A8", breathe: 5.4, drift: 0.75 },
  // Steady & Trustworthy — muted teal, even pace.
  amit: { core: "#3D6B6B", accent: "#6FA3A0", breathe: 4.6, drift: 0.9 },
  // Rich & Cinematic — deep plum, languid drift.
  kabir: { core: "#5A3F6B", accent: "#9070A8", breathe: 5.0, drift: 0.85 },
  // Casual & Relatable — earthy olive, relaxed.
  dev: { core: "#5C6B3D", accent: "#94A36B", breathe: 4.2, drift: 1.0 },

  // --- Female voices -------------------------------------------------------
  // Cheerful & Engaging — warm coral, lively.
  priya: { core: "#B05744", accent: "#E0917A", breathe: 3.6, drift: 1.25 },
  // Polished & Articulate — refined burgundy, composed.
  ishita: { core: "#8A3F55", accent: "#C07A90", breathe: 4.4, drift: 0.95 },
  // Energetic & Warm — amber, the fastest of the set.
  neha: { core: "#B07A32", accent: "#E0B070", breathe: 3.3, drift: 1.35 },
  // Gentle & Soothing — soft sage, the slowest.
  roopa: { core: "#5E7A63", accent: "#96B39A", breathe: 6.0, drift: 0.65 },
  // Bright & Warm — golden rose, buoyant.
  shreya: { core: "#A85F5F", accent: "#D89A94", breathe: 3.9, drift: 1.1 },
};

export function personaForVoice(voiceId: string | null | undefined): VoicePersona {
  if (!voiceId) return DEFAULT_PERSONA;
  return PERSONAS[voiceId] ?? DEFAULT_PERSONA;
}
