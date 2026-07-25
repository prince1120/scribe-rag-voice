"use client";

// A ring of bars around the orb, driven by the real frequency spectrum of
// whoever is currently speaking.
//
// The orb already reacts to overall volume, which conveys *how loud* but not
// *what* — a flat tone and a spoken sentence push it identically. Frequency
// data gives the texture back: vowels, consonants and pitch all move different
// bars, so the ring visibly tracks speech rather than looping an animation
// that happens to be playing while someone talks.
//
// Canvas rather than DOM nodes: 64 bars re-styled every frame is 64 layout
// invalidations per frame, which is exactly the kind of thing that turns a
// 60fps animation into a janky one on a mid-range phone.

import { useEffect, useRef } from "react";

const BAR_COUNT = 64;
// The top of the FFT range is mostly silence for speech, and including it
// leaves a third of the ring permanently flat.
const USABLE_SPECTRUM = 0.62;

export interface VoiceSpectrumProps {
  /** Read at each frame rather than passed as a value: the analyser is
   *  swapped when the agent's track is published or the mic is replaced, and
   *  a stale reference would freeze the ring. */
  getAnalyser: () => AnalyserNode | null;
  color: string;
  size: number;
  /** Inner edge of the bars, as a fraction of half the canvas. */
  radiusRatio?: number;
  active: boolean;
}

export function VoiceSpectrum({
  getAnalyser,
  color,
  size,
  radiusRatio = 0.52,
  active,
}: VoiceSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  // Smoothed per-bar heights, so bars ease rather than snap between frames.
  const levelsRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Honour the OS setting: this is continuous peripheral motion, exactly
    // what reduced-motion exists to suppress.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    // Match the backing store to device pixels or the bars are blurry on any
    // HiDPI screen.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    context.scale(dpr, dpr);

    const center = size / 2;
    const innerRadius = center * radiusRatio;
    const maxBarLength = center - innerRadius - 2;
    let spectrum: Uint8Array | null = null;

    const draw = () => {
      frameRef.current = requestAnimationFrame(draw);
      context.clearRect(0, 0, size, size);

      const analyser = getAnalyser();
      const levels = levelsRef.current;

      if (analyser && active) {
        if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
          spectrum = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(spectrum as Uint8Array<ArrayBuffer>);

        const usableBins = Math.floor(spectrum.length * USABLE_SPECTRUM);
        const binsPerBar = Math.max(1, Math.floor(usableBins / BAR_COUNT));

        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < binsPerBar; j++) {
            sum += spectrum[i * binsPerBar + j] ?? 0;
          }
          const target = sum / binsPerBar / 255;
          // Asymmetric smoothing: rise quickly so an attack reads as sharp,
          // fall slowly so the ring settles instead of flickering.
          const current = levels[i];
          levels[i] = target > current
            ? current + (target - current) * 0.5
            : current + (target - current) * 0.12;
        }
      } else {
        // Decay to rest when nobody is speaking.
        for (let i = 0; i < BAR_COUNT; i++) levels[i] *= 0.9;
      }

      context.save();
      context.translate(center, center);
      context.strokeStyle = color;
      context.lineCap = "round";
      context.lineWidth = Math.max(1.5, (size / BAR_COUNT) * 0.5);

      for (let i = 0; i < BAR_COUNT; i++) {
        const level = levels[i];
        if (level < 0.01) continue;

        // Start at 12 o'clock so the ring reads as symmetric.
        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const length = 2 + level * maxBarLength;

        context.globalAlpha = 0.25 + level * 0.75;
        context.beginPath();
        context.moveTo(cos * innerRadius, sin * innerRadius);
        context.lineTo(cos * (innerRadius + length), sin * (innerRadius + length));
        context.stroke();
      }

      context.restore();
    };

    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [getAnalyser, color, size, radiusRatio, active]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute pointer-events-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
