import Link from "next/link";
import { ScribeMark } from "../Logo";

export const metadata = {
  title: "Terms of Service — Scribe",
  description: "Terms of Service for Scribe — RAG and voice assistant for business documents.",
};

export default function TermsPage() {
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
              Terms
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
            Terms of Service
          </h1>
          <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--claude-muted)" }}>
            These Terms govern your use of Scribe — a self-hosted retrieval-augmented generation and voice assistant that answers from your own documents. By creating a business assistant, uploading documents, or starting a call or chat, you agree to them.
          </p>
        </div>

        <div className="rounded-2xl border p-5 sm:p-6 flex flex-col gap-4" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>1. What Scribe provides</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Scribe lets a business owner upload documents (PDF, DOCX, PPTX, XLSX, CSV, images, etc.), chunk and index them with hybrid dense + sparse search and cross-encoder reranking, and serve a deployed assistant that answers by text chat and by live voice call with grounded citations. The same pipeline powers both surfaces. Optional features include a public directory listing, shareable call links, and a bring-your-own-model option for any OpenAI-compatible endpoint.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>2. Accounts, keys, and tenancy</h2>
            <ul className="text-sm mt-1 leading-relaxed list-disc pl-5" style={{ color: "var(--claude-text-2)" }}>
              <li>Visitor demo sessions derive a tenant from your Groq + Sarvam keys and browser client id. Your documents and conversations are isolated to that tenant and are not visible to other visitors.</li>
              <li>Your API keys are sent as `X-User-Groq-Key` / `X-User-Sarvam-Key` and are used only to bill your own provider account. We do not log key values; they are not stored server-side for demo tenants.</li>
              <li>Owner workspace access is gated by an app passcode and session cookie. Keep them private. You are responsible for activity under your workspace.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>3. Your documents and license</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              You retain ownership of every file you upload. You grant Scribe a limited, revocable license to store the file, extract text (including OCR via Groq vision for scanned pages), create embeddings, store vectors in Qdrant, and re-generate file formats when you use the in-place editor. Deleting a document removes its file, database row, and vectors during the next cleanup sweep. Do not upload material you do not have the right to use.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>4. AI limitations — citations are not guarantees</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Answers are generated by a large language model constrained to retrieved chunks and rendered with `[doc.chunk]` citations. Citations reduce risk but do not eliminate hallucination. Scribe is not a substitute for professional legal, medical, financial, or safety advice. Verify critical answers against the source document, especially before quoting prices, policies, or compliance guidance to a customer.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>5. Voice calls, recording, and transcripts</h2>
            <ul className="text-sm mt-1 leading-relaxed list-disc pl-5" style={{ color: "var(--claude-text-2)" }}>
              <li>Every voice call produces an audio recording and a transcript with citation tags. The business owner can review them in the dashboard.</li>
              <li>You are responsible for obtaining any consent required in your jurisdiction before recording a call, and for informing callers that the assistant is an AI and that the call may be recorded.</li>
              <li>Call links (`/t/&lt;token&gt;`) are bearer links. Anyone with the link can join until it expires, is rotated, or reaches its session limit.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>6. Public directory</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              If you deploy your assistant and opt into the directory, Scribe publishes only your handle, business name, category, assistant name, and greeting — never your tenant id or private documents. You can unpublish by undeploying or rotating your directory handle. Directory discovery is rate-limited (30/min for listing, 5/min for connect) and newly deployed assistants may take up to 60 seconds to appear due to caching.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>7. Acceptable use and limits</h2>
            <ul className="text-sm mt-1 leading-relaxed list-disc pl-5" style={{ color: "var(--claude-text-2)" }}>
              <li>Do not use Scribe to generate spam, harassment, impersonation, or to process sensitive personal data without a lawful basis.</li>
              <li>Demo tenants are capped on documents and retrieval depth; directory visitors are capped on sessions per day and total businesses contacted. Production budgets, call-length, and idle limits are enforced when enabled.</li>
              <li>We may rate-limit or suspend use that degrades the service for others, including aggressive scraping of the directory.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>8. Bring-your-own model</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Custom model base URLs, keys, and model ids you add in Settings are stored only in your browser (`localStorage`) and are sent per-request to the backend and to the voice worker for that call. They are not persisted server-side. You are responsible for the terms and billing of any third-party provider you connect.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>9. Availability and changes</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Scribe is provided as-is. We do not guarantee uninterrupted availability; Qdrant, Redis, LiveKit, or upstream model providers may be temporarily unavailable. We may update the service, these Terms, or the directory caching behavior with notice in the app or docs. Continued use after an update constitutes acceptance.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--claude-text)" }}>10. Liability and indemnity</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              To the maximum extent permitted by law, Scribe is not liable for indirect, incidental, or consequential damages, including lost profits or customer claims arising from an assistant’s answer. You indemnify Scribe against claims arising from your documents, your directory listing, or your use of call recordings.
            </p>
          </div>

          <div className="pt-4 border-t" style={{ borderColor: "var(--claude-border)" }}>
            <p className="text-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>
              Questions? Contact the workspace owner or open an issue in the repository. For privacy details, see our <Link href="/privacy" className="underline underline-offset-2" style={{ color: "var(--claude-accent)" }}>Privacy Policy</Link>.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Link href="/privacy" className="text-xs font-medium px-4 py-2 rounded-full border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-text)" }}>
            Privacy Policy →
          </Link>
          <Link href="/" className="text-xs font-medium px-4 py-2 rounded-full text-white" style={{ background: "var(--claude-accent)" }}>
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
