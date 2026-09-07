import Link from "next/link";
import { ScribeMark } from "../Logo";

export const metadata = {
  title: "Privacy Policy — Scribe",
  description: "Privacy Policy for Scribe — how documents, calls, and keys are handled.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--claude-bg)", color: "var(--claude-text)" }}>
      <header className="border-b" style={{ borderColor: "var(--claude-border)", background: "rgba(240,238,230,0.88)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-full flex items-center justify-center border" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)", color: "var(--claude-accent)" }}>
              <ScribeMark className="w-4 h-4" />
            </div>
            <span className="font-editorial font-bold text-[17px] tracking-tight" style={{ color: "var(--claude-text)" }}>
              Scribe
            </span>
            <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-muted)" }}>
              Privacy
            </span>
          </Link>
          <Link href="/" className="text-xs font-medium px-3.5 py-1.5 rounded-full border hover:border-[var(--claude-border-strong)] transition-colors" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-text-2)" }}>
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--claude-muted)" }}>
            Legal · Last updated 5 September 2026
          </p>
          <h1 className="font-editorial font-bold tracking-tight mt-2" style={{ color: "var(--claude-text)", fontSize: "clamp(28px, 4vw, 38px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Privacy Policy
          </h1>
          <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--claude-muted)" }}>
            Scribe is designed to keep your documents and your customers’ conversations private, isolated by tenant, and deletable. This policy explains what we store, where it lives, and how to remove it.
          </p>
        </div>

        <div className="rounded-2xl border p-5 sm:p-6 flex flex-col gap-5" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>1. What we collect</h2>
            <ul className="text-sm mt-1 leading-relaxed list-disc pl-5" style={{ color: "var(--claude-text-2)" }}>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Documents you upload</span> — file, extracted text, chunk embeddings, and vectors. Purpose: retrieval for your assistant.</li>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Conversations</span> — messages, citations, and call transcripts per conversation. Purpose: history and audit.</li>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Contacts and links</span> — name, token hash, expiry, session counts for invite and directory links.</li>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Voice preferences</span> — speaker and persona choice stored in your browser, not on the server.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>2. Where it lives</h2>
            <ul className="text-sm mt-1 leading-relaxed list-disc pl-5" style={{ color: "var(--claude-text-2)" }}>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>SQLite (rag.db)</span> — durable metadata for documents, conversations, messages, contacts.</li>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Qdrant</span> — one shared collection, filtered by `tenant_id`; holds chunk text and vectors.</li>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Redis</span> — live rolling context for the current turn; falls back to in-process memory if unavailable and is lost on restart.</li>
              <li><span className="font-medium" style={{ color: "var(--claude-text)" }}>Filesystem</span> — original uploads under `uploads/`; regenerated on edit.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>3. Tenancy and isolation</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Demo visitors are isolated by a hash of their Groq + Sarvam keys and browser client id. Different browsers with the same Groq key still get separate tenants. The default owner workspace uses server keys and is never mixed with demo tenants. Qdrant queries are always filtered by `tenant_id`.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>4. API keys</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Demo keys are sent per-request as `X-User-Groq-Key` / `X-User-Sarvam-Key` and are used only to call the provider for that turn. They are not written to the database. Custom OpenAI-compatible base URLs and keys you add in Settings live only in `localStorage` and are forwarded per-request to the backend and, for voice, to the worker via LiveKit dispatch metadata. Remove them in Settings to clear them.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>5. Voice calls</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Voice uses LiveKit for media, Sarvam for speech-to-text and text-to-speech, and Groq (or your custom LLM) for reasoning. Audio is routed through LiveKit; transcripts are stored as messages under the contact. The worker’s health is checked via an HTTP probe on port 8081; audio is not stored by the STT/TTS providers beyond the turn.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>6. Directory</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              The public directory at `/directory` lists only handle, business name, category, assistant name, and greeting for deployed assistants. No tenant ids or documents are published. Listing is cached for 60 seconds; unpublishing via undeploy or handle rotation takes effect within that window.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>7. Retention and deletion</h2>
            <ul className="text-sm mt-1 leading-relaxed list-disc pl-5" style={{ color: "var(--claude-text-2)" }}>
              <li>Deleting a document in the UI removes its file, row, and Qdrant vectors on the next cleanup sweep.</li>
              <li>Invite and directory links expire per their `expires_at` and session caps; expired links are not reusable.</li>
              <li>You can clear a demo tenant by clearing site data in the browser, which rotates the client id and derived tenant.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>8. Cookies and local storage</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              We use a session cookie for owner authentication and `localStorage` for selected model, custom endpoints, voice choice, caller name, and demo client id. No advertising trackers.
            </p>
          </div>

          <div className="pt-4 border-t" style={{ borderColor: "var(--claude-border)" }}>
            <p className="text-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>
              Questions or deletion requests? Contact the workspace owner. For the rules governing use, see our <Link href="/terms" className="underline underline-offset-2" style={{ color: "var(--claude-accent)" }}>Terms of Service</Link>.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Link href="/terms" className="text-xs font-medium px-4 py-2 rounded-full border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-text)" }}>
            Terms of Service →
          </Link>
          <Link href="/" className="text-xs font-medium px-4 py-2 rounded-full text-white" style={{ background: "var(--claude-accent)" }}>
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
