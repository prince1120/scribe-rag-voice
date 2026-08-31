// Personal-session persistence.
//
// The personal app has no accounts: a visitor's identity *is* the API keys
// they paste, and those keys live only in their browser. This module is the
// single owner of every localStorage key that implies — read, write, migrate,
// and forget happen here and nowhere else — so the storage format can change
// without touching UI code (dependency inversion: hooks depend on this
// interface, not on raw localStorage).

import type { CustomModel } from "./customModel";

export interface KeyPair {
  groqKey: string;
  sarvamKey: string;
}

const KEYS = {
  groq: "demo_groq_key",
  sarvam: "demo_sarvam_key",
  model: "demo_selected_model",
  customModels: "custom_models",
  keyHistory: "demo_session_key_history", // legacy, pre-client-id location
  legacyKeyHistory: "demo_groq_key_history",
  keyHistoryFor: (clientId: string) => `demo_session_key_history_${clientId}`,
  ragSettings: "rag_settings",
  clientId: "app_client_id",
} as const;

export const MAX_KEY_HISTORY = 5;

export const DEFAULT_MODEL = "openai/gpt-oss-20b";

export interface GenerationSettings {
  topK: number;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_GENERATION: GenerationSettings = {
  topK: 5,
  temperature: 0.1,
  maxTokens: 800,
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — persistence is best-effort */
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isValidPair(item: unknown): item is KeyPair {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as KeyPair).groqKey === "string" &&
    typeof (item as KeyPair).sarvamKey === "string"
  );
}

// ---- Client id ---------------------------------------------------------------

/** A stable id for this browser. Not proof of identity — it can be cleared —
 *  but it survives IP rotation, which is what backend velocity checks need. */
export function loadOrCreateClientId(): string {
  let id = readString(KEYS.clientId);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    writeString(KEYS.clientId, id);
  }
  return id;
}

// ---- Keys --------------------------------------------------------------------

export const keyStore = {
  loadGroq(): string {
    return readString(KEYS.groq) ?? "";
  },
  saveGroq(key: string | null): void {
    writeString(KEYS.groq, key || null);
  },
  loadSarvam(): string {
    return readString(KEYS.sarvam) ?? "";
  },
  saveSarvam(key: string | null): void {
    writeString(KEYS.sarvam, key || null);
  },

  /** Recent key pairs, most-recently-used first. Reads the per-client store,
   *  falling back to the legacy shared one; migrates old groq-only entries. */
  loadHistory(clientId: string): KeyPair[] {
    const stored =
      readJson<unknown[]>(KEYS.keyHistoryFor(clientId)) ??
      readJson<unknown[]>(KEYS.keyHistory);
    if (stored) return stored.filter(isValidPair);

    const legacy = readJson<string[]>(KEYS.legacyKeyHistory);
    if (Array.isArray(legacy)) {
      return legacy
        .filter((k): k is string => typeof k === "string")
        .map((groqKey) => ({ groqKey, sarvamKey: "" }));
    }
    return [];
  },

  saveHistory(clientId: string, history: KeyPair[]): void {
    writeJson(
      clientId ? KEYS.keyHistoryFor(clientId) : KEYS.keyHistory,
      history
    );
  },

  /** Most-recent-first, deduped by Groq key, capped. Pure — returns the next
   *  list rather than mutating, so callers keep ownership of their state. */
  upsert(history: KeyPair[], pair: KeyPair): KeyPair[] {
    return [
      pair,
      ...history.filter((item) => item.groqKey !== pair.groqKey),
    ].slice(0, MAX_KEY_HISTORY);
  },
};

// ---- Model selection ---------------------------------------------------------

export const modelStore = {
  loadSelected(): string {
    return readString(KEYS.model) ?? DEFAULT_MODEL;
  },
  saveSelected(model: string): void {
    writeString(KEYS.model, model);
  },

  loadCustom(): CustomModel[] {
    const parsed = readJson<CustomModel[]>(KEYS.customModels);
    return Array.isArray(parsed) ? parsed : [];
  },
  saveCustom(models: CustomModel[]): void {
    writeJson(KEYS.customModels, models);
  },
};

// ---- Generation settings -------------------------------------------------------

export const generationStore = {
  load(): Partial<GenerationSettings> | null {
    const parsed = readJson<Partial<GenerationSettings>>(KEYS.ragSettings);
    if (!parsed) return null;
    const out: Partial<GenerationSettings> = {};
    if (typeof parsed.topK === "number") out.topK = parsed.topK;
    if (typeof parsed.temperature === "number") out.temperature = parsed.temperature;
    if (typeof parsed.maxTokens === "number") out.maxTokens = parsed.maxTokens;
    return out;
  },
  save(settings: GenerationSettings): void {
    writeJson(KEYS.ragSettings, settings);
  },
};
