"use client";

// useCustomModels — the visitor's own OpenAI-compatible endpoints.
//
// Selection and the catalogue are two concerns: the catalogue (which models
// exist) is edited here; selection (which one is active) is shared with chat
// and voice, so it is exposed as a controlled value. Persistence goes through
// lib/personalSession's modelStore — this hook never reads storage directly.

import { useCallback, useEffect, useState } from "react";
import {
  modelStore,
  DEFAULT_MODEL,
} from "../lib/personalSession";
import {
  customModelId,
  resolveCustomModel,
  type CustomModel,
} from "../lib/customModel";

export interface CustomModelsApi {
  customModels: CustomModel[];
  selectedModel: string;
  /** The selected custom endpoint, or null when a built-in model is active. */
  activeCustomModel: CustomModel | null;
  selectModel: (modelId: string) => void;
  addCustom: (draft: Omit<CustomModel, "id">) => void;
  removeCustom: (id: string) => void;
}

export function useCustomModels(): CustomModelsApi {
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setSelectedModel(modelStore.loadSelected());
    setCustomModels(modelStore.loadCustom());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    modelStore.saveSelected(selectedModel);
  }, [selectedModel, mounted]);

  useEffect(() => {
    if (!mounted) return;
    modelStore.saveCustom(customModels);
  }, [customModels, mounted]);

  const addCustom = useCallback((draft: Omit<CustomModel, "id">) => {
    const id = Date.now().toString(36);
    setCustomModels((prev) => [...prev, { ...draft, id }]);
    setSelectedModel(customModelId(id));
  }, []);

  const removeCustom = useCallback(
    (id: string) => {
      setCustomModels((prev) => prev.filter((m) => m.id !== id));
      // Deselecting the active custom model must leave a valid selection.
      setSelectedModel((current) =>
        current === customModelId(id) ? DEFAULT_MODEL : current
      );
    },
    []
  );

  return {
    customModels,
    selectedModel,
    activeCustomModel: resolveCustomModel(customModels, selectedModel),
    selectModel: setSelectedModel,
    addCustom,
    removeCustom,
  };
}
