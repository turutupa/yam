import { useEffect, useRef } from "react";
import type { AudioSpectrum } from "../types";

type Props = {
  spectrum: AudioSpectrum | null;
  hasSignal: boolean;
};

export function SpectrumAnalyzer({ spectrum, hasSignal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const barsRef = useRef<number[]>(new Array(16).fill(0));

  useEffect(() => {
    if (spectrum) {
      barsRef.current = spectrum.bands;
    }
  }, [spectrum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const bars = barsRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const numBars = bars.length;
      const gap = 1.5;
      const barWidth = (w - gap * (numBars - 1)) / numBars;

      ctx.clearRect(0, 0, w, h);

      // Get accent color from CSS custom property
      const style = getComputedStyle(canvas);
      const accent = style.getPropertyValue("--accent").trim() || "#f59e0b";

      for (let i = 0; i < numBars; i++) {
        const barH = bars[i] * h;
        const x = i * (barWidth + gap);
        const y = h - barH;

        // Gradient: accent at top, dimmer at bottom
        const alpha = 0.3 + bars[i] * 0.7;
        ctx.fillStyle = accent;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 1);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div
      className={`spectrum-analyzer ${hasSignal ? "has-signal" : ""}`}
    >
      <canvas
        ref={canvasRef}
        width={96}
        height={32}
        className="spectrum-canvas"
      />
    </div>
  );
}
