"use client";

// Settings & Account Profile: Business details, Provider API Keys, and Security credentials.

import { useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Mail,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { ownerFetch } from "../lib/ownerFetch";
import { OwnerShell } from "../components/owner/OwnerShell";
import { getWorkspaceCache, setWorkspaceCache, useWorkspace } from "../lib/workspaceCache";

export default function SettingsPage() {
  const ws = useWorkspace();
  const cached = getWorkspaceCache();

  // `?? ""` rather than a placeholder: these are form fields, and an unloaded
  // workspace means an empty input, not someone else's business name.
  const [businessName, setBusinessName] = useState<string>(
    () => cached.businessName ?? ws.businessName ?? ""
  );
  const [category, setCategory] = useState<string>(() => cached.businessCategory || "");
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>(() => cached.categoriesData || []);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [email, setEmail] = useState<string>(() => cached.email ?? ws.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Provider credentials
  const [providers, setProviders] = useState<{
    groq_key?: string | null;
    sarvam_key?: string | null;
    custom_llm_key?: string | null;
    custom_llm_base_url?: string | null;
    llm_model?: string | null;
  }>(() => cached.providersData || {});
  const [groqKey, setGroqKey] = useState("");
  const [sarvamKey, setSarvamKey] = useState("");
  const [customUrl, setCustomUrl] = useState(() => cached.providersData?.custom_llm_base_url || "");
  const [customKey, setCustomKey] = useState("");
  const [model, setModel] = useState(() => cached.providersData?.llm_model || "");
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysSaved, setKeysSaved] = useState(false);
  const [keyError, setKeyError] = useState("");

  // Password / Secret toggles
  const [showGroq, setShowGroq] = useState(false);
  const [showSarvam, setShowSarvam] = useState(false);
  const [showCustomKey, setShowCustomKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [wsRes, provRes, catRes] = await Promise.all([
          ownerFetch("/api/v1/workspace"),
          ownerFetch("/api/v1/workspace/providers"),
          ownerFetch("/api/v1/workspace/categories"),
        ]);
        if (cancelled) return;
        if (wsRes.ok) {
          const wsData = await wsRes.json();
          setBusinessName(wsData.business_name || "");
          setCategory(wsData.business_category || "");
          if (wsData.email) setEmail(wsData.email);
          setWorkspaceCache({
            businessName: wsData.business_name,
            businessCategory: wsData.business_category,
            email: wsData.email,
          });
        }
        if (provRes.ok) {
          const data = await provRes.json();
          setProviders(data);
          setCustomUrl(data.custom_llm_base_url || "");
          setModel(data.llm_model || "");
          setWorkspaceCache({ providersData: data });
        }
        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(catData.categories || []);
          setWorkspaceCache({ categoriesData: catData.categories || [] });
        }
      } catch {
        /* Fall back gracefully */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName.trim(),
          business_category: category,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not update business profile.");
      }
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();

    if (password && password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password: password || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not save credentials.");
      }

      setDone(true);
      setPassword("");
      setConfirm("");
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save credentials.");
    } finally {
      setBusy(false);
    }
  }

  async function saveKeys(event: React.FormEvent) {
    event.preventDefault();
    setSavingKeys(true);
    setKeyError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groq_key: groqKey.trim() || undefined,
          sarvam_key: sarvamKey.trim() || undefined,
          custom_llm_key: customKey.trim() || undefined,
          custom_llm_base_url: customUrl.trim() || undefined,
          llm_model: model.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not save API keys.");
      }
      setProviders(await response.json());
      setGroqKey("");
      setSarvamKey("");
      setCustomKey("");
      setKeysSaved(true);
      setTimeout(() => setKeysSaved(false), 2500);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Could not save API keys.");
    } finally {
      setSavingKeys(false);
    }
  }

  return (
    <OwnerShell businessName={businessName}>
      <main style={S.page}>
        {/* Header */}
        <header style={S.header}>
          <div>
            <h1 style={S.title}>Account & Business Profile</h1>
            <p style={S.subtitle}>
              Manage your public business identity, provider AI keys, and login credentials.
            </p>
          </div>
        </header>

        {/* ── Card 1: Business Identity ────────────────────────── */}
        <form style={S.card} onSubmit={saveProfile}>
          <div style={S.cardHeader}>
            <div style={{ ...S.iconWrap, background: "#ede9fe", color: "#6d28d9" }}>
              <Building2 size={18} />
            </div>
            <div>
              <h2 style={S.cardTitle}>Business Identity</h2>
              <p style={S.cardSub}>
                How your business appears to callers, on share links, and in the public directory.
              </p>
            </div>
          </div>

          <div style={S.twoColGrid}>
            <div>
              <label style={S.label}>Business Name</label>
              <input
                style={S.input}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Shiro art and craft"
                maxLength={200}
                required
              />
            </div>

            <div>
              <label style={S.label}>Business Category</label>
              <select
                style={S.input}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Choose a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {profileError && <p style={S.errorText}>{profileError}</p>}
          {profileSaved && (
            <div style={S.successBanner}>
              <CheckCircle2 size={15} style={{ color: "#16a34a" }} />
              <span>Business profile saved successfully.</span>
            </div>
          )}

          <div style={S.cardFooter}>
            <button
              type="submit"
              disabled={savingProfile || !businessName.trim()}
              style={S.primaryBtn}
            >
              <Save size={14} />
              <span>{savingProfile ? "Saving…" : "Save Business Profile"}</span>
            </button>
          </div>
        </form>

        {/* ── Card 2: AI Keys & Models ─────────────────────────── */}
        <form style={S.card} onSubmit={saveKeys}>
          <div style={S.cardHeader}>
            <div style={{ ...S.iconWrap, background: "#e0e7ff", color: "#4f46e5" }}>
              <KeyRound size={18} />
            </div>
            <div>
              <h2 style={S.cardTitle}>AI Keys & Model Providers</h2>
              <p style={S.cardSub}>
                Your assistant runs on your account. Keys are encrypted at rest and never shown in plaintext.
              </p>
            </div>
          </div>

          {/* Section A: Core Voice & LLM Keys */}
          <div style={S.twoColGrid}>
            {/* Groq Key */}
            <div style={S.fieldBox}>
              <div style={S.labelRow}>
                <label style={S.label}>Groq API Key (LLM Inference)</label>
                {providers.groq_key ? (
                  <span style={S.badgeSaved}>Active: {providers.groq_key}</span>
                ) : (
                  <span style={S.badgeMissing}>Required</span>
                )}
              </div>
              <div style={S.passwordInputWrap}>
                <input
                  style={S.passwordInput}
                  type={showGroq ? "text" : "password"}
                  autoComplete="off"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder={providers.groq_key ? "Leave blank to keep saved key" : "gsk_…"}
                />
                <button
                  type="button"
                  onClick={() => setShowGroq(!showGroq)}
                  style={S.eyeBtn}
                  title="Toggle visibility"
                >
                  {showGroq ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Sarvam Key */}
            <div style={S.fieldBox}>
              <div style={S.labelRow}>
                <label style={S.label}>Sarvam AI Key (Voice Synthesis & STT)</label>
                {providers.sarvam_key ? (
                  <span style={S.badgeSaved}>Active: {providers.sarvam_key}</span>
                ) : (
                  <span style={S.badgeOptional}>Needed for voice</span>
                )}
              </div>
              <div style={S.passwordInputWrap}>
                <input
                  style={S.passwordInput}
                  type={showSarvam ? "text" : "password"}
                  autoComplete="off"
                  value={sarvamKey}
                  onChange={(e) => setSarvamKey(e.target.value)}
                  placeholder={providers.sarvam_key ? "Leave blank to keep saved key" : "Enter Sarvam key…"}
                />
                <button
                  type="button"
                  onClick={() => setShowSarvam(!showSarvam)}
                  style={S.eyeBtn}
                  title="Toggle visibility"
                >
                  {showSarvam ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* Section B: Model & Custom Providers */}
          <div style={{ ...S.twoColGrid, marginTop: 4 }}>
            {/* Model Override */}
            <div>
              <label style={S.label}>Default Model Name</label>
              <input
                style={S.input}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. llama-3.1-8b-instant (or leave blank)"
              />
            </div>

            {/* Custom LLM Base URL */}
            <div>
              <label style={S.label}>
                Custom LLM Base URL <span style={{ color: "#94a3b8", fontWeight: 400 }}>(Optional)</span>
              </label>
              <input
                style={S.input}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="e.g. https://api.mistral.ai/v1 or OpenRouter"
              />
            </div>
          </div>

          {/* Custom Key */}
          <div>
            <div style={S.labelRow}>
              <label style={S.label}>
                Custom Endpoint API Key <span style={{ color: "#94a3b8", fontWeight: 400 }}>(Optional)</span>
              </label>
              {providers.custom_llm_key && (
                <span style={S.badgeSaved}>Active: {providers.custom_llm_key}</span>
              )}
            </div>
            <div style={S.passwordInputWrap}>
              <input
                style={S.passwordInput}
                type={showCustomKey ? "text" : "password"}
                autoComplete="off"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder={providers.custom_llm_key ? "Leave blank to keep saved key" : "Bearer key…"}
              />
              <button
                type="button"
                onClick={() => setShowCustomKey(!showCustomKey)}
                style={S.eyeBtn}
              >
                {showCustomKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {keyError && <p style={S.errorText}>{keyError}</p>}
          {keysSaved && (
            <div style={S.successBanner}>
              <CheckCircle2 size={15} style={{ color: "#16a34a" }} />
              <span>Provider API keys updated successfully.</span>
            </div>
          )}

          <div style={S.cardFooter}>
            <button type="submit" disabled={savingKeys} style={S.primaryBtn}>
              <Save size={14} />
              <span>{savingKeys ? "Saving Keys…" : "Save API Keys"}</span>
            </button>
          </div>
        </form>

        {/* ── Card 3: Security & Passwords ─────────────────────── */}
        <form style={S.card} onSubmit={save}>
          <div style={S.cardHeader}>
            <div style={{ ...S.iconWrap, background: "#fdf2f8", color: "#db2777" }}>
              <Lock size={18} />
            </div>
            <div>
              <h2 style={S.cardTitle}>Owner Profile & Credentials</h2>
              <p style={S.cardSub}>
                Your registered owner email and login credentials for direct console access.
              </p>
            </div>
          </div>

          <div>
            <label style={S.label}>Owner Email Address</label>
            <input
              style={S.input}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setDone(false);
              }}
              autoComplete="email"
              placeholder="owner@yourbusiness.com"
              required
            />
          </div>

          <div style={S.twoColGrid}>
            <div>
              <label style={S.label}>
                Change Password <span style={{ color: "#94a3b8", fontWeight: 400 }}>(Leave blank to keep current)</span>
              </label>
              <input
                style={S.input}
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setDone(false);
                }}
                autoComplete="new-password"
                minLength={8}
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label style={S.label}>Confirm New Password</label>
              <input
                style={S.input}
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setDone(false);
                }}
                autoComplete="new-password"
                placeholder="Repeat password"
              />
            </div>
          </div>

          {error && <p style={S.errorText}>{error}</p>}
          {done && (
            <div style={S.successBanner}>
              <CheckCircle2 size={15} style={{ color: "#16a34a" }} />
              <span>Owner credentials saved successfully.</span>
            </div>
          )}

          <div style={S.cardFooter}>
            <button
              type="submit"
              disabled={busy || !email.trim()}
              style={S.primaryBtn}
            >
              <ShieldCheck size={14} />
              <span>{busy ? "Saving…" : "Save Owner Profile"}</span>
            </button>
          </div>
        </form>
      </main>
    </OwnerShell>
  );
}

/* ─────────────────────────── Styles ─────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: "56rem",
    paddingBottom: 48,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
    margin: 0,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "20px 22px",
    borderRadius: 16,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: 12,
  },
  iconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 10,
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
  },
  cardSub: {
    fontSize: 12,
    color: "#64748b",
    margin: "2px 0 0",
  },
  twoColGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
    alignItems: "start",
  },
  fieldBox: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  labelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    flexWrap: "wrap",
    gap: 4,
    minHeight: 20,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#334155",
    margin: 0,
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    fontSize: 13,
    color: "#0f172a",
    boxSizing: "border-box",
    outline: "none",
  },
  passwordInputWrap: {
    display: "flex",
    alignItems: "center",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    overflow: "hidden",
  },
  passwordInput: {
    flex: 1,
    padding: "9px 12px",
    border: "none",
    background: "transparent",
    fontSize: 13,
    color: "#0f172a",
    outline: "none",
  },
  eyeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 12px",
    background: "transparent",
    border: "none",
    color: "#64748b",
    cursor: "pointer",
  },
  badgeSaved: {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 6,
    background: "#f0fdf4",
    color: "#16a34a",
    border: "1px solid #bbf7d0",
    whiteSpace: "nowrap",
  },
  badgeMissing: {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 6,
    background: "#fef2f2",
    color: "#dc2626",
    border: "1px solid #fecaca",
    whiteSpace: "nowrap",
  },
  badgeOptional: {
    fontSize: 10,
    fontWeight: 500,
    padding: "2px 6px",
    borderRadius: 6,
    background: "#f1f5f9",
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  cardFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: 10,
    borderTop: "1px solid #f1f5f9",
  },
  primaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 18px",
    borderRadius: 8,
    border: "none",
    background: "#4f46e5",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(79, 70, 229, 0.25)",
  },
  errorText: {
    fontSize: 12,
    color: "#dc2626",
    margin: 0,
    fontWeight: 500,
  },
  successBanner: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 8,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534",
    fontSize: 12,
    fontWeight: 500,
  },
};
