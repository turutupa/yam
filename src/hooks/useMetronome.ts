import { useEffect, useState, useCallback } from "react";
import type { AppState, BeatEvent } from "../types";
import { getState, onBeat, onStateChange } from "../ipc";

const DEFAULT_STATE: AppState = {
  bpm: 120,
  isPlaying: false,
  subdivision: 1,
  mode: "comfortable",
  corner: "top-right",
  alwaysOnTop: true,
  accentColor: "#e94560",
  volume: 0.8,
  soundType: "click",
  timeSignature: 4,
};

export function useMetronome() {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [currentBeat, setCurrentBeat] = useState<BeatEvent | null>(null);

  useEffect(() => {
    getState().then(setState).catch(() => {});

    const unlistenState = onStateChange((s) => setState(s));
    const unlistenBeat = onBeat((b) => setCurrentBeat(b));

    return () => {
      unlistenState.then((fn) => fn());
      unlistenBeat.then((fn) => fn());
    };
  }, []);

  // Apply accent color to CSS variables whenever it changes
  useEffect(() => {
    const hex = state.accentColor;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Relative luminance (sRGB) — bright colors get dark text
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const textColor = luminance > 0.6 ? "#1a1a2e" : "#ffffff";
    document.documentElement.style.setProperty("--accent", hex);
    document.documentElement.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.3)`);
    document.documentElement.style.setProperty("--accent-glow-strong", `rgba(${r}, ${g}, ${b}, 0.5)`);
    document.documentElement.style.setProperty("--accent-text", textColor);
  }, [state.accentColor]);

  // Sync beat accent color CSS variable
  useEffect(() => {
    // Find matching beat accent from ACCENT_COLORS lookup
    const BEAT_ACCENT_MAP: Record<string, string> = {
      "#e94560": "#ff9eb0", "#ff6b6b": "#ffb8b8", "#ff9a76": "#ffd4b8",
      "#f59e0b": "#fde68a", "#84cc16": "#d9f99d", "#10b981": "#6ee7b7",
      "#14b8a6": "#5eead4", "#06b6d4": "#67e8f9", "#0ea5e9": "#7dd3fc",
      "#3b82f6": "#93c5fd", "#6366f1": "#a5b4fc", "#8b5cf6": "#c4b5fd",
      "#a855f7": "#d8b4fe", "#d946ef": "#f0abfc", "#ec4899": "#f9a8d4",
      "#e2e8f0": "#ffffff",
    };
    const ba = BEAT_ACCENT_MAP[state.accentColor.toLowerCase()] || "#ffffff";
    document.documentElement.style.setProperty("--beat-accent", ba);
  }, [state.accentColor]);

  const resetBeat = useCallback(() => {
    setCurrentBeat(null);
  }, []);

  return { state, currentBeat, resetBeat };
}
