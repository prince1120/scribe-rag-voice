"use client";

import Link from "next/link";

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  tag: string;
  good_for?: "voice" | "chat" | "both";
}

interface Props {
  models: ModelOption[];
  selectedModel: string;
  baseUrl: string;
  savedApiKey?: string | null;
  apiKeyInput: string;
  isCustom: boolean;
  onSelectGroqModel: (model: string) => void;
  onSelectSarvam: () => void;
  onEnableCustom: () => void;
  onDisableCustom: (model?: string) => void;
  onChangeBaseUrl: (url: string) => void;
  onChangeApiKey: (key: string) => void;
  onChangeCustomModel: (model: string) => void;
  onClearKey: () => void;
  onSave: () => void;
  saving: boolean;
  testResult?: { ok: boolean; message: string } | null;
}

export function ChannelModelPicker(props: Props) {
  const sarvam = props.baseUrl === "https://api.sarvam.ai/v1";
  const provider = sarvam ? "sarvam" : props.isCustom ? "custom" : "groq";
  return (
    <section id="agent-llm" className="agent-section">
      <h2 className="agent-label">Agent LLM</h2>
      <p className="agent-hint">One model for this agent’s voice and text replies. STT and TTS always use Sarvam.</p>
      <label className="agent-label" htmlFor="agent-provider">Provider</label>
      <select id="agent-provider" className="agent-input" value={provider} onChange={(event) => {
        if (event.target.value === "sarvam") props.onSelectSarvam();
        else if (event.target.value === "groq") props.onDisableCustom(props.models[0]?.id);
        else props.onEnableCustom();
      }}>
        <option value="sarvam">Sarvam — default</option>
        <option value="groq">Groq</option>
        <option value="custom">Custom OpenAI-compatible provider</option>
      </select>
      {provider === "groq" ? <>
        <label className="agent-label" htmlFor="agent-model">Model</label>
        <select id="agent-model" className="agent-input" value={props.selectedModel} onChange={(event) => props.onSelectGroqModel(event.target.value)}>
          {!props.models.some((model) => model.id === props.selectedModel) && <option value={props.selectedModel}>{props.selectedModel || "Choose a model"}</option>}
          {props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <p className="agent-hint">Uses the Groq key in <Link href="/settings#provider-keys">Settings</Link>.</p>
        <button type="button" className="agent-custom-save-btn" onClick={props.onSave} disabled={props.saving || !props.selectedModel.trim()}>Save and test connection</button>
      </> : <div className="agent-custom-fields">
        <div className="agent-custom-field">
          <label className="agent-label" htmlFor="agent-model">Model ID</label>
          {sarvam ? <>
            <select id="agent-model" className="agent-input" value={props.selectedModel} onChange={(event) => props.onChangeCustomModel(event.target.value)}>
              {!["sarvam-105b-conversations", "sarvam-105b"].includes(props.selectedModel) && <option value={props.selectedModel}>{props.selectedModel || "Choose a model"} — change to a supported model</option>}
              <option value="sarvam-105b-conversations">Sarvam 105B Conversations — default for voice</option>
              <option value="sarvam-105b">Sarvam 105B — general purpose, longer context</option>
            </select>
            {!["sarvam-105b-conversations", "sarvam-105b"].includes(props.selectedModel) && <button type="button" className="links-btn" onClick={() => props.onChangeCustomModel("sarvam-105b-conversations")}>Use recommended default</button>}
          </> : <input id="agent-model" className="agent-input" value={props.selectedModel} onChange={(event) => props.onChangeCustomModel(event.target.value)} placeholder="Model ID from your provider" />}
        </div>
        {sarvam ? <>
          <div className="agent-custom-field">
            <label className="agent-label" htmlFor="agent-endpoint">API base URL — automatic</label>
            <input id="agent-endpoint" className="agent-input" type="url" value={props.baseUrl} readOnly />
          </div>
          <p className="agent-hint">Recommended: Sarvam 105B Conversations for real-time voice and chat. Thinking is disabled; voice replies stream as they are generated.</p>
          <p className="agent-hint">Uses the same Sarvam key as STT and TTS. Manage it once in <Link href="/settings#provider-keys">Settings</Link>. For another endpoint, select Custom OpenAI-compatible provider.</p>
        </> : <>
          <div className="agent-custom-field">
            <label className="agent-label" htmlFor="agent-endpoint">API base URL</label>
            <input id="agent-endpoint" className="agent-input" type="url" value={props.baseUrl} onChange={(event) => props.onChangeBaseUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" />
          </div>
          <div className="agent-custom-field">
            <label className="agent-label" htmlFor="agent-key">Agent API key{props.savedApiKey ? ` · saved ${props.savedApiKey}` : ""}</label>
            <input id="agent-key" className="agent-input" type="password" autoComplete="off" value={props.apiKeyInput} onChange={(event) => props.onChangeApiKey(event.target.value)} placeholder={props.savedApiKey ? "Leave blank to keep the saved key" : "Enter your provider key"} />
            <p className="agent-hint">Encrypted on the server. Used by this agent only. Changing the endpoint requires its matching key.</p>
            {props.savedApiKey && <button type="button" className="links-btn" onClick={props.onClearKey}>Remove agent key</button>}
          </div>
        </>}
        <button type="button" className="agent-custom-save-btn" onClick={props.onSave} disabled={props.saving || !props.selectedModel.trim() || !props.baseUrl.trim()}>
          {props.saving ? "Saving and testing…" : "Save and test connection"}
        </button>
      </div>}
      {props.testResult && <p className="agent-hint" role="status" style={{ color: props.testResult.ok ? "var(--color-success)" : "var(--color-danger)" }}>{props.testResult.message}</p>}
    </section>
  );
}
