// A user-added OpenAI-compatible model — any provider that speaks the OpenAI
// chat-completions protocol (Mistral, OpenRouter, a self-hosted server, ...).
// Stored in localStorage only; the API key never touches our own server
// config, it's sent per-request the same way the Groq/Sarvam demo keys are.

export interface CustomModel {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const CUSTOM_MODEL_PREFIX = "custom:";

export function customModelId(id: string): string {
  return `${CUSTOM_MODEL_PREFIX}${id}`;
}

/** Resolve the selected model value into a usable model id + credentials, or
 *  null when the selection is one of the built-in Groq models. */
export function resolveCustomModel(
  models: CustomModel[],
  selectedModel: string
): CustomModel | null {
  if (!selectedModel.startsWith(CUSTOM_MODEL_PREFIX)) return null;
  const id = selectedModel.slice(CUSTOM_MODEL_PREFIX.length);
  return models.find((m) => m.id === id) ?? null;
}
