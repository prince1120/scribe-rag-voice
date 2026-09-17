"use client";

import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download, ImagePlus, Package, QrCode, RotateCcw } from "lucide-react";

type Props = {
  productName: string;
  modelNumber: string;
  supportUrl: string;
};

export default function ProductQrReveal({ productName, modelNumber, supportUrl }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const revealTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(supportUrl, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 720,
      color: { dark: "#171712", light: "#ffffff" },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setQrError("Could not create the QR preview. Please close this window and try again.");
    });
    return () => { active = false; };
  }, [supportUrl]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
  }, [photoUrl]);

  const pixels = useMemo(() => Array.from({ length: 64 }, (_, index) => index), []);

  const choosePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) return;
    setPhotoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setRevealed(false);
  };

  const reveal = () => {
    if (!qrDataUrl || revealing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    setRevealing(true);
    revealTimer.current = window.setTimeout(() => {
      setRevealing(false);
      setRevealed(true);
    }, 950);
  };

  const reset = () => {
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
    setRevealing(false);
    setRevealed(false);
  };

  return (
    <section className="qr-reveal" aria-label="Product QR preview">
      <div className={`qr-reveal__stage${revealing ? " is-revealing" : ""}${revealed ? " is-revealed" : ""}`}>
        <div className="qr-reveal__product">
          {photoUrl ? (
            // Blob previews are local-only and cannot use Next's image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={`${productName} preview`} />
          ) : (
            <Package aria-hidden="true" />
          )}
          <span>{productName}</span>
          <small>{modelNumber}</small>
        </div>
        <div className="qr-reveal__pixels" aria-hidden="true">
          {pixels.map((pixel) => (
            <i
              key={pixel}
              style={{
                "--pixel": pixel,
                "--pixel-x": (pixel % 7 - 3) * 9,
                "--pixel-y": (pixel % 5 - 2) * 8,
              } as CSSProperties}
            />
          ))}
        </div>
        {qrDataUrl && (
          // A data URL preserves the exact QR pixels for reliable scanning.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="qr-reveal__code" src={qrDataUrl} alt={`Support QR code for ${productName}`} />
        )}
      </div>

      <div className="qr-reveal__copy">
        <strong>{revealed ? "Your support QR is ready" : "Turn this product into instant support"}</strong>
        <p>{revealed ? "This is the real scannable code. Download it for packaging or manuals." : "Add an optional product photo, then reveal its customer support QR."}</p>
      </div>

      <div className="qr-reveal__actions">
        {!revealed && !revealing && (
          <label className="qr-reveal__file">
            <ImagePlus size={16} /> Choose photo
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={choosePhoto} />
          </label>
        )}
        {!revealed ? (
          <button type="button" onClick={reveal} disabled={!qrDataUrl || revealing} className="qr-reveal__primary">
            <QrCode size={16} /> {revealing ? "Forming QR…" : "Reveal support QR"}
          </button>
        ) : (
          <>
            <a href={qrDataUrl} download={`${productName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-support-qr.png`} className="qr-reveal__primary">
              <Download size={16} /> Download PNG
            </a>
            <button type="button" onClick={reset} className="qr-reveal__file"><RotateCcw size={16} /> Show product</button>
          </>
        )}
      </div>
      {qrError && <p className="qr-reveal__error" role="alert">{qrError}</p>}
      {!photoUrl && !revealed && <small className="qr-reveal__note">Photo is used only for this preview and is not uploaded.</small>}
    </section>
  );
}
