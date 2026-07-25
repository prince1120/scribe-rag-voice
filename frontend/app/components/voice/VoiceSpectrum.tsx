"use client";

// The reactive ring around the orb.
//
// The first version drew 64 radial bars — a literal audio spectrum. It read as
// a music visualiser: spiky, busy, and lifted from a media player rather than
// belonging to a conversation. Every voice agent people compare this to
// (ChatGPT, Gemini Live, Siri) uses smooth continuous deformation instead, and
// they are right to: speech is fluid, and a serious assistant should look
// composed rather than excitable.
//
// So the same audio drives a closed Catmull-Rom curve. Frequency bands still
// push control points outward, but the curve through them is continuous, so
// the shape swells and settles like something breathing instead of flickering
// bar by bar.

import { useEffect, useRef } from "react";

// Few points, heavily smoothed: more points means more high-frequency wobble,
// which is exactly the busyness being avoided.
const POINTS = 12;
const USABLE_SPECTRUM = 0.55;

export interface VoiceSpectrumProps {
  /** Read per frame: analysers are swapped when the agent's track is
   *  published or the mic changes, so a captured reference goes stale. */
  getAnalyser: () => AnalyserNode | null;
  color: string;
  size: number;
  active: boolean;
}

export function VoiceSpectrum({ getAnalyser, color, size, active }: VoiceSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const levelsRef = useRef<Float32Array>(new Float32Array(POINTS));
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    context.scale(dpr, dpr);

    const center = size / 2;
    // Sits clearly outside the 176px orb (88px radius) — at 0.72 the curve
    // grazed the orb edge and read as clipping it rather than surrounding it.
    const baseRadius = center * 0.86;
    const maxSwell = center * 0.13;
    let spectrum: Uint8Array | null = null;

    const draw = () => {
      frameRef.current = requestAnimationFrame(draw);
      context.clearRect(0, 0, size, size);

      const analyser = getAnalyser();
      const levels = levelsRef.current;
      // Slow rotation so the shape never looks frozen between utterances.
      phaseRef.current += 0.0022;

      if (analyser && active) {
        if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
          spectrum = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(spectrum as Uint8Array<ArrayBuffer>);

        const usable = Math.floor(spectrum.length * USABLE_SPECTRUM);
        const perPoint = Math.max(1, Math.floor(usable / POINTS));

        for (let i = 0; i < POINTS; i++) {
          let sum = 0;
          for (let j = 0; j < perPoint; j++) sum += spectrum[i * perPoint + j] ?? 0;
          const target = Math.min(1, sum / perPoint / 190);
          // Ease both ways, and slower than the bar version: the goal is a
          // swell, not a twitch.
          levels[i] += (target - levels[i]) * (target > levels[i] ? 0.22 : 0.08);
        }
      } else {
        for (let i = 0; i < POINTS; i++) levels[i] *= 0.94;
      }

      // Control points, then a closed curve through them.
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < POINTS; i++) {
        const angle = (i / POINTS) * Math.PI * 2 + phaseRef.current;
        // A gentle idle undulation keeps the ring alive while silent, without
        // implying someone is speaking.
        const idle = Math.sin(phaseRef.current * 2.4 + i * 1.7) * 0.035;
        const radius = baseRadius + (levels[i] + idle) * maxSwell;
        points.push({
          x: center + Math.cos(angle) * radius,
          y: center + Math.sin(angle) * radius,
        });
      }

      context.beginPath();
      for (let i = 0; i < POINTS; i++) {
        const p0 = points[(i - 1 + POINTS) % POINTS];
        const p1 = points[i];
        const p2 = points[(i + 1) % POINTS];
        const p3 = points[(i + 2) % POINTS];
        // Catmull-Rom expressed as a cubic Bézier, so the curve passes through
        // every control point with continuous tangents — no visible seams.
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        if (i === 0) context.moveTo(p1.x, p1.y);
        context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      context.closePath();

      const energy = levels.reduce((a, b) => a + b, 0) / POINTS;

      // Stroke only. A filled curve overlapped the orb and dulled it.
      context.globalAlpha = 0.3 + energy * 0.45;
      context.strokeStyle = color;
      context.lineWidth = 1.75;
      context.shadowBlur = 12 + energy * 20;
      context.shadowColor = color;
      context.stroke();
      context.shadowBlur = 0;
      context.globalAlpha = 1;
    };

    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [getAnalyser, color, size, active]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute pointer-events-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
