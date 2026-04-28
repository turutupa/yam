import { useMetronome } from "../hooks/useMetronome";
import { useDrag } from "../hooks/useDrag";
import { useState, useRef } from "react";
import { togglePlayback, setBpm, setSubdivision, setTimeSignature, showMain } from "../ipc";
import type { Subdivision } from "../types";
import "../styles/floating-widget.css";

const SUBDIVISION_LABELS: Record<Subdivision, string> = {
  1: "♩",
  2: "♫",
  3: "♪³",
  4: "♬",
  5: "♪⁵",
  6: "♬⁶",
};

const SUBDIVISION_NAMES: Record<Subdivision, string> = {
  1: "Quarter",
  2: "Eighth",
  3: "Triplet",
  4: "16th",
  5: "Quintuplet",
  6: "Sextuplet",
};

const TIME_SIG_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 1, label: "Always" },
  { value: 2, label: "2/4" },
  { value: 3, label: "3/4" },
  { value: 4, label: "4/4" },
  { value: 5, label: "5/4" },
  { value: 6, label: "6/8" },
  { value: 7, label: "7/8" },
];

export function FloatingWidget() {
  useDrag();
  const { state, currentBeat } = useMetronome();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const beatsPerMeasure = state.timeSignature >= 2 ? state.timeSignature : 2;
  const activeBeat = currentBeat ? currentBeat.beat % beatsPerMeasure : -1;
  const activeSub = currentBeat ? currentBeat.subdivision : -1;
  const isDownbeat = currentBeat?.isDownbeat ?? false;
  // Widget shows up to 5 dots; if more, cap at 5 and map via modulo
  const widgetBeats = Math.min(beatsPerMeasure, 5);
  const widgetActiveBeat = activeBeat >= 0
    ? (beatsPerMeasure <= 5 ? activeBeat : activeBeat % widgetBeats)
    : -1;
  const isAccentBeat = (beatIdx: number) => {
    if (state.timeSignature === 1) return true; // Always
    if (state.timeSignature >= 2 && beatIdx === 0) {
      // When capped, accent fires when the real beat is 0
      return beatsPerMeasure <= 5 ? activeBeat === 0 : activeBeat === 0;
    }
    return false;
  };

  const startEdit = () => {
    setEditValue(String(state.bpm));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    const val = parseInt(editValue);
    if (!isNaN(val)) setBpm(Math.max(20, Math.min(300, val)));
    setEditing(false);
  };

  const bpmDisplay = editing ? (
    <input
      ref={inputRef}
      className="fw-bpm fw-bpm-edit"
      type="text"
      inputMode="numeric"
      value={editValue}
      onChange={(e) => setEditValue(e.target.value.replace(/\D/g, ""))}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitEdit();
        if (e.key === "Escape") setEditing(false);
      }}
      autoFocus
    />
  ) : (
    <span className="fw-bpm fw-bpm-clickable" onClick={startEdit}>{state.bpm}</span>
  );

  if (state.mode === "compact") {
    return (
      <div className="floating-widget compact" data-playing={state.isPlaying}>
        {bpmDisplay}
        <button className="fw-play" onClick={() => togglePlayback()}>
          {state.isPlaying ? "■" : "▶"}
        </button>
        <button className="fw-settings" onClick={() => showMain()} title="Settings">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    );
  }

  const cycleSubdivision = () => {
    const next = state.subdivision === 6 ? 1 : ((state.subdivision + 1) as Subdivision);
    setSubdivision(next);
  };

  const cycleTimeSig = () => {
    const idx = TIME_SIG_OPTIONS.findIndex(o => o.value === state.timeSignature);
    const next = TIME_SIG_OPTIONS[(idx + 1) % TIME_SIG_OPTIONS.length];
    setTimeSignature(next.value);
  };

  const timeSigLabel = TIME_SIG_OPTIONS.find(o => o.value === state.timeSignature)?.label || "4/4";

  return (
    <div className="floating-widget comfortable" data-playing={state.isPlaying}>
      <div className="fw-top-row">
        <div className="fw-bpm-control">
          <button className="fw-bpm-adj" onClick={() => setBpm(state.bpm - 5)}>
            <svg width="10" height="2" viewBox="0 0 10 2"><rect width="10" height="2" rx="1" fill="currentColor"/></svg>
          </button>
          <div className="fw-bpm-group">
            {bpmDisplay}
            <span className="fw-bpm-unit">BPM</span>
          </div>
          <button className="fw-bpm-adj" onClick={() => setBpm(state.bpm + 5)}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="4" y="0" width="2" height="10" rx="1" fill="currentColor"/><rect x="0" y="4" width="10" height="2" rx="1" fill="currentColor"/></svg>
          </button>
        </div>
        <button className="fw-play" onClick={() => togglePlayback()}>
          {state.isPlaying ? "■" : "▶"}
        </button>
        <button className="fw-settings" onClick={() => showMain()} title="Settings">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>

      <div className="fw-bottom-row">
        <div className="fw-btn-group">
          <button className="fw-sub-btn" onClick={cycleSubdivision} title={SUBDIVISION_NAMES[state.subdivision]}>
            <span className="fw-sub-icon">{SUBDIVISION_LABELS[state.subdivision]}</span>
            <span className="fw-sub-name">{SUBDIVISION_NAMES[state.subdivision]}</span>
          </button>

          <button className="fw-sub-btn" onClick={cycleTimeSig} title="Time Signature">

            <span className="fw-sub-name">{timeSigLabel}</span>
          </button>
        </div>

        <div className="fw-beat-row">
          {Array.from({ length: widgetBeats }, (_, beatIdx) => {
            const isBeatActive = widgetActiveBeat === beatIdx && isDownbeat;
            const isBeatDownbeat = isBeatActive && isAccentBeat(beatIdx);
            return (
              <div key={beatIdx} className="fw-beat-group">
                <span
                  className={`fw-beat-dot ${isBeatActive ? "active" : ""} ${isBeatDownbeat ? "downbeat" : ""}`}
                />
                {state.subdivision > 1 && (
                  <div className="fw-sub-dots">
                    {Array.from({ length: state.subdivision - 1 }, (_, subIdx) => (
                      <span
                        key={subIdx}
                        className={`fw-sub-dot ${
                          widgetActiveBeat === beatIdx && activeSub === subIdx + 1 ? "active" : ""
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
