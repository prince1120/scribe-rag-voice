"use client";

// useGenerationSettings — top_k / temperature / max_tokens for the personal
// chat. Pure state + persistence; consumers treat it as a read-only value
// object and mutate only through the setter passed to the settings panel.

import { useCallback, useEffect, useState } from "react";
import {
  generationStore,
  DEFAULT_GENERATION,
  type GenerationSettings,
} from "../lib/personalSession";

export interface GenerationSettingsApi extends GenerationSettings {
  setTopK: (value: number) => void;
  setTemperature: (value: number) => void;
  setMaxTokens: (value: number) => void;
  reset: () => void;
}

export function useGenerationSettings(): GenerationSettingsApi {
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const saved = generationStore.load();
    if (saved) {
      setSettings((prev) => ({ ...prev, ...saved }));
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    generationStore.save(settings);
  }, [settings, mounted]);

  const setTopK = useCallback(
    (topK: number) => setSettings((prev) => ({ ...prev, topK })),
    []
  );
  const setTemperature = useCallback(
    (temperature: number) => setSettings((prev) => ({ ...prev, temperature })),
    []
  );
  const setMaxTokens = useCallback(
    (maxTokens: number) => setSettings((prev) => ({ ...prev, maxTokens })),
    []
  );
  const reset = useCallback(() => setSettings(DEFAULT_GENERATION), []);

  return { ...settings, setTopK, setTemperature, setMaxTokens, reset };
}
