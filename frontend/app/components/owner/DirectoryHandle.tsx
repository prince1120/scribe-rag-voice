"use client";

// The workspace's public directory handle, and the button that rotates it.
//
// The handle is what the public directory publishes instead of the tenant id.
// Rotating it is the remedy when a business is being targeted: every harvested
// copy stops resolving immediately, while documents, contacts, and the invite
// links the owner has already sent are untouched — those are keyed on the
// tenant id, which is not published.

import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";

import { ownerFetch } from "../../lib/ownerFetch";

export function DirectoryHandle() {
  const [handle, setHandle] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await ownerFetch("/api/v1/workspace/directory-handle");
      if (!res.ok) throw new Error();
      setHandle((await res.json()).handle);
    } catch {
      setError("Could not load your directory handle.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rotate() {
    // Confirmed because it is not undoable and it breaks something real: any
    // directory listing someone has open, or a link they were about to use,
    // stops working the moment this returns.
    if (
      !window.confirm(
        "Give this workspace a new public address?\n\n" +
          "Anyone currently looking at your listing will need to reload it. " +
          "Your invite links, documents, and call history are not affected."
      )
    ) {
      return;
    }

    setRotating(true);
    setError("");
    try {
      const res = await ownerFetch("/api/v1/workspace/directory-handle/rotate", {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      setHandle((await res.json()).handle);
    } catch {
      setError("Could not change it. Try again.");
    } finally {
      setRotating(false);
    }
  }

  if (!handle && !error) return null;

  return (
    <div className="dir-handle">
      <div className="dir-handle-head">
        <span className="dir-handle-icon" aria-hidden="true">
          <Globe size={15} />
        </span>
        <div>
          <h3 className="dir-handle-title">Public directory address</h3>
          <p className="dir-handle-sub">
            How visitors reach you from the public directory. Change it if you
            start getting unwanted calls.
          </p>
        </div>
      </div>

      {handle && <code className="dir-handle-value">{handle}</code>}
      {error && <p className="dir-handle-error">{error}</p>}

      <button
        type="button"
        className="dir-handle-btn ds-pressable ds-tap"
        onClick={rotate}
        disabled={rotating}
      >
        <RefreshCw size={13} aria-hidden="true" />
        <span>{rotating ? "Changing…" : "Get a new address"}</span>
      </button>
    </div>
  );
}
