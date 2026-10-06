"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ownerFetch } from "../../lib/ownerFetch";
import { extractApiErrorMessage, formatClientError } from "../../lib/apiErrors";

type Address = { handle: string; code: string };

export function DirectoryHandle({ snapshotId }: { snapshotId?: string }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const endpoint = snapshotId ? `/api/v1/workspace/agents/${encodeURIComponent(snapshotId)}/address` : "/api/v1/workspace/directory-handle";
        const response = await ownerFetch(endpoint);
        if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Could not load sharing details."));
        const data: Address = await response.json();
        const link = `${window.location.origin}/link/${data.handle}`;
        if (cancelled) return;
        setAddress(data); setUrl(link); setError(""); setNotice("");
        const QRCode = await import("qrcode");
        const png = await QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: "M" });
        if (!cancelled) setQr(png);
      } catch (err) {
        if (!cancelled) setError(formatClientError(err, "Could not load sharing details."));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [snapshotId, retry]);

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); }
    catch { setError("Copy was unavailable. Select and copy the displayed text."); }
  }

  return (
    <section className="dir-handle space-y-4" aria-label="Share assistant">
      <div><h3 className="dir-handle-title">Share this assistant</h3>
        <p className="dir-handle-sub">Link, QR and code stay the same after edits and publishing. Customers can connect when this assistant is published. No documents required.</p>
      </div>
      {!address && !error && <p role="status" className="text-sm">Loading sharing details…</p>}
      {address && <>
        <div><span className="block text-xs mb-1">Assistant code · enter at /talk</span>
          <code className="text-2xl tracking-widest select-all">{address.code.slice(0, 4)} {address.code.slice(4)}</code>
          <button type="button" className="dir-handle-btn ml-3" onClick={() => void copy(address.code, "Code")}>Copy code</button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <a href={url} target="_blank" rel="noreferrer" className="text-sm underline break-all">{url}</a>
          <button type="button" className="dir-handle-btn" onClick={() => void copy(url, "Link")}>Copy link</button>
        </div>
        {qr && <div className="flex flex-wrap items-center gap-4">
          <Image src={qr} width={160} height={160} alt="QR code to open this assistant" unoptimized />
          <a href={qr} download={`assistant-${address.code}.png`} className="dir-handle-btn">Download QR</a>
        </div>}
        <a href="/talk" className="text-sm underline">Open the code dialler</a>
      </>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <div><p role="alert" className="dir-handle-error">{error}</p><button type="button" className="dir-handle-btn" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    </section>
  );
}
