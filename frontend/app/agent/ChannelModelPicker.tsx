"use client";

// Model selection for a single channel (voice or chat).
//
// Curated Groq models are served from the backend catalogue so the owner
// console and personal app share a single source of truth. Any other
// OpenAI-compatible endpoint (Mistral, OpenRouter, self-hosted Ollama/vLLM)
// is reachable via the custom provider toggle.

import React from "react";

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  tag: string;
  good_for?: "voice" | "chat" | "both";
}

interface ChannelModelPickerProps {
  channel: "voice" | "chat";
  models: ModelOption[];
  selectedModel: string;
  baseUrl: string;
  savedApiKey?: string | null;
  apiKeyInput: string;
  isCustom: boolean;
  onSelectGroqModel: (modelId: string) => void;
  onEnableCustom: () => void;
  onDisableCustom: (fallbackModelId?: string) => void;
  onChangeBaseUrl: (url: string) => void;
  onChangeApiKey: (key: string) => void;
  onChangeCustomModel: (model: string) => void;
}

export function ChannelModelPicker({
  channel,
  models,
  selectedModel,
  baseUrl,
  savedApiKey,
  apiKeyInput,
  isCustom,
  onSelectGroqModel,
  onEnableCustom,
  onDisableCustom,
  onChangeBaseUrl,
  onChangeApiKey,
  onChangeCustomModel,
}: ChannelModelPickerProps) {
  const isVoice = channel === "voice";

  return (
    <section className="agent-section">
      <div className="agent-model-header">
        <div>
          <span className="agent-label">Model</span>
          <p className="agent-hint">
            {isVoice
              ? "Voice calls prioritize low time-to-first-token to prevent awkward dead air."
              : "Chat responses can use larger reasoning models behind a streaming cursor."}
          </p>
        </div>
      </div>

      {!isCustom ? (
        <div className="agent-models-wrapper">
          <div className="agent-models-grid" role="radiogroup" aria-label="Model options">
            {models.map((m) => {
              const isSelected = selectedModel === m.id || (!selectedModel && m.good_for === channel);
              const isRecommended = m.good_for === channel || m.good_for === "both";

              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`agent-model-card ds-pressable ds-tap ${isSelected ? "is-active" : ""}`}
                  onClick={() => onSelectGroqModel(m.id)}
                >
                  <div className="agent-model-top">
                    <span className="agent-model-name">{m.name}</span>
                    <span className="agent-model-tag">{m.tag}</span>
                  </div>

                  <p className="agent-model-desc">{m.description}</p>

                  <div className="agent-model-foot">
                    {isRecommended ? (
                      <span className="agent-model-badge">
                        {m.good_for === "both"
                          ? "Great for both"
                          : isVoice
                          ? "Recommended for calls"
                          : "Recommended for chat"}
                      </span>
                    ) : (
                      <span />
                    )}

                    {isSelected && (
                      <span className="agent-model-check" aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
                          <path
                            d="M3.5 8.5l3 3 6-6"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Custom provider entry card */}
            <button
              type="button"
              className="agent-model-card agent-model-custom-trigger ds-pressable ds-tap"
              onClick={onEnableCustom}
            >
              <div className="agent-model-top">
                <span className="agent-model-name">Custom provider</span>
                <span className="agent-model-tag">OpenAI</span>
              </div>
              <p className="agent-model-desc">
                Connect OpenRouter, Mistral, Ollama, Together AI, or a self-hosted endpoint.
              </p>
              <div className="agent-model-foot">
                <span className="agent-model-link">Configure endpoint →</span>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <div className="agent-custom-box ds-animate-rise">
          <div className="agent-custom-head">
            <div>
              <span className="agent-custom-title">Custom OpenAI-compatible provider</span>
              <p className="agent-hint">
                Route {isVoice ? "voice" : "chat"} calls to any OpenAI-compatible API endpoint.
              </p>
            </div>
            <button
              type="button"
              className="agent-custom-back-btn ds-pressable ds-tap"
              onClick={() => onDisableCustom(isVoice ? "openai/gpt-oss-20b" : "openai/gpt-oss-120b")}
            >
              ← Use Groq models
            </button>
          </div>

          <div className="agent-custom-fields">
            <div className="agent-custom-field">
              <label className="agent-label" htmlFor={`custom-model-${channel}`}>
                Model Identifier
              </label>
              <input
                id={`custom-model-${channel}`}
                className="agent-input"
                value={selectedModel || ""}
                onChange={(e) => onChangeCustomModel(e.target.value)}
                placeholder={isVoice ? "e.g. meta-llama/llama-3.1-8b-instruct" : "e.g. mistral-large-latest"}
                autoFocus
              />
              <span className="agent-hint">The model ID expected by the target endpoint.</span>
            </div>

            <div className="agent-custom-field">
              <label className="agent-label" htmlFor={`custom-url-${channel}`}>
                Base URL
              </label>
              <input
                id={`custom-url-${channel}`}
                className="agent-input"
                value={baseUrl || ""}
                onChange={(e) => onChangeBaseUrl(e.target.value)}
                placeholder="https://api.mistral.ai/v1"
              />
              <span className="agent-hint">
                e.g. https://openrouter.ai/api/v1, https://api.together.xyz/v1, http://localhost:11434/v1
              </span>
            </div>

            <div className="agent-custom-field">
              <label className="agent-label" htmlFor={`custom-key-${channel}`}>
                API Key {savedApiKey && <span className="agent-optional">Saved: {savedApiKey}</span>}
              </label>
              <input
                id={`custom-key-${channel}`}
                className="agent-input"
                type="password"
                autoComplete="off"
                value={apiKeyInput}
                onChange={(e) => onChangeApiKey(e.target.value)}
                placeholder={savedApiKey ? "Leave blank to keep saved key" : "sk-…"}
              />
              <span className="agent-hint">
                Encrypted before storage. Never exposed to browser clients.
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
