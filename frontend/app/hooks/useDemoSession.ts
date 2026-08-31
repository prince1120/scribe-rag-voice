"use client";

// useDemoSession — owns the personal session's key state.
//
// A "session" here is just a pair of API keys the visitor pasted; there are no
// accounts. This hook is the single writer of that state and of its
// localStorage persistence (via lib/personalSession), so every other surface —
// chat, voice, documents — receives credentials as plain values and never
// touches storage itself.

import { useCallback, useEffect, useState } from "react";
import {
  keyStore,
  loadOrCreateClientId,
  type KeyPair,
} from "../lib/personalSession";
import { ToastType } from "../Toast";

interface UseDemoSessionOptions {
  notify: (message: string, type?: ToastType) => void;
}

export interface DemoSession {
  groqKey: string;
  sarvamKey: string;
  clientId: string;
  /** True once a Groq key is present — chat works immediately. Voice
   *  requires sarvamKey as well and is disabled until added. */
  isActive: boolean;
  hasVoiceKey: boolean;
  keyHistory: KeyPair[];
  start: (groqKey: string, sarvamKey?: string) => void;
  end: () => void;
  switchGroqKey: (newKey: string) => void;
  switchPair: (pair: KeyPair) => void;
  forgetPair: (groqKey: string) => void;
  updateSarvam: (key: string) => void;
}

export function useDemoSession({ notify }: UseDemoSessionOptions): DemoSession {
  const [groqKey, setGroqKey] = useState("");
  const [sarvamKey, setSarvamKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [keyHistory, setKeyHistory] = useState<KeyPair[]>([]);
  // False until mounted effects run: reading localStorage during render would
  // desync server and client markup.
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage — intentional synchronous setState on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const id = loadOrCreateClientId();
    setClientId(id);
    setGroqKey(keyStore.loadGroq());
    setSarvamKey(keyStore.loadSarvam());
    setKeyHistory(keyStore.loadHistory(id));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    keyStore.saveGroq(groqKey || null);
  }, [groqKey, mounted]);

  useEffect(() => {
    if (!mounted) return;
    keyStore.saveSarvam(sarvamKey || null);
  }, [sarvamKey, mounted]);

  const persistHistory = useCallback(
    (next: KeyPair[]) => {
      setKeyHistory(next);
      keyStore.saveHistory(clientId, next);
    },
    [clientId]
  );

  const start = useCallback(
    (key: string, sKey?: string) => {
      const trimmedGroq = key.trim();
      const trimmedSarvam = (sKey ?? sarvamKey).trim();
      if (!trimmedGroq) {
        notify("Groq API Key is required to start a session.", "error");
        return;
      }
      setGroqKey(trimmedGroq);
      setSarvamKey(trimmedSarvam);
      persistHistory(keyStore.upsert(keyHistory, { groqKey: trimmedGroq, sarvamKey: trimmedSarvam }));
      if (!trimmedSarvam) {
        notify("Chat ready. Add Sarvam key in Settings to enable voice.", "info");
      }
    },
    [sarvamKey, keyHistory, persistHistory, notify]
  );

  const end = useCallback(() => {
    setGroqKey("");
    setSarvamKey("");
  }, []);

  const requireGroqOnly = useCallback(
    (nextGroq: string): boolean => {
      if (!nextGroq) {
        notify("Groq API Key is required.", "error");
        return false;
      }
      return true;
    },
    [notify]
  );

  const switchGroqKey = useCallback(
    (newKey: string) => {
      const trimmed = newKey.trim();
      if (!trimmed || trimmed === groqKey) return;
      if (!requireGroqOnly(trimmed)) return;
      start(trimmed, sarvamKey);
      notify("Switched Groq key — chat continues.", "info");
    },
    [groqKey, sarvamKey, requireGroqOnly, start, notify]
  );

  const switchPair = useCallback(
    (pair: KeyPair) => {
      if (!pair.groqKey) {
        notify("Groq API Key is required.", "error");
        return;
      }
      start(pair.groqKey, pair.sarvamKey || undefined);
      notify(pair.sarvamKey ? "Switched key pairs." : "Switched Groq key — add Sarvam in Settings for voice.", "info");
    },
    [start, notify]
  );

  const forgetPair = useCallback(
    (groqKeyStr: string) => {
      persistHistory(keyHistory.filter((item) => item.groqKey !== groqKeyStr));
    },
    [keyHistory, persistHistory]
  );

  const updateSarvam = useCallback(
    (key: string) => {
      setSarvamKey(key.trim());
      notify(key.trim() ? "Updated Sarvam API key." : "Removed Sarvam API key.", "info");
    },
    [notify]
  );

  return {
    groqKey,
    sarvamKey,
    clientId,
    isActive: Boolean(groqKey),
    hasVoiceKey: Boolean(groqKey && sarvamKey),
    keyHistory,
    start,
    end,
    switchGroqKey,
    switchPair,
    forgetPair,
    updateSarvam,
  };
}
