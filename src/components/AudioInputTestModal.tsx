import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { AudioInputDevice, AudioSpectrum } from "../types";
import {
  listAudioInputDevices,
  startEvaluation,
  stopEvaluation,
  onAudioSpectrum,
  storeSave,
  storeLoad,
  setInputGain,
  startRecording,
  stopRecording,
  startPlayback,
  stopPlayback,
  discardRecording,
  getWaveform,
  onPlaybackFinished,
} from "../ipc";

interface Props {
  open: boolean;
  onClose: () => void;
  selectedDevice: string | undefined;
  onDeviceChange: (device: string) => void;
  initialDevices?: AudioInputDevice[];
  /** If true, evaluation stream is already running — skip start/stop */
  evaluationActive?: boolean;
}

type RecState = "idle" | "recording" | "recorded" | "playing";

export default function AudioInputTestModal({ open, onClose, selectedDevice, onDeviceChange, initialDevices, evaluationActive }: Props) {
  const [devices, setDevices] = useState<AudioInputDevice[]>(initialDevices ?? []);
  const [listening, setListening] = useState(false);
  const [spectrum, setSpectrum] = useState<AudioSpectrum | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Smoothed RMS for stable dB display
  const smoothRmsRef = useRef(0);

  // Debounced signal status
  const [hasSignal, setHasSignal] = useState(false);
  const signalTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Recording/playback state
  const [recState, setRecState] = useState<RecState>("idle");
  const [recDuration, setRecDuration] = useState(0);
  const [recElapsed, setRecElapsed] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [playProgress, setPlayProgress] = useState(0);
  const [inputGainDb, setInputGainDb] = useState(20); // 0 to +40 dB, default +20
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const playbackUnlistenRef = useRef<(() => void) | null>(null);

  // Load devices when modal opens
  useEffect(() => {
    if (open) {
      // Refresh device list in background (initialDevices provides instant display)
      listAudioInputDevices().then(setDevices);
      // Restore saved gain for current device
      storeLoad<number>(`inputGain_${selectedDevice ?? "__default"}`).then((g) => {
        const gain = g ?? 20;
        setInputGainDb(gain);
        setInputGain(gain);
      });
    } else {
      // Clean up everything when modal closes
      if (listening) stopEvaluation();
      setListening(false);
      setSpectrum(null);
      setHasSignal(false);
      smoothRmsRef.current = 0;
      setRecState("idle");
      setRecDuration(0);
      setRecElapsed(0);
      setWaveform([]);
      setPlayProgress(0);
      if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
      if (playbackUnlistenRef.current) { playbackUnlistenRef.current(); playbackUnlistenRef.current = null; }
      clearInterval(timerRef.current);
      clearTimeout(signalTimerRef.current);
    }
  }, [open]);

  // Start listening automatically when modal opens
  useEffect(() => {
    if (!open) return;
    if (evaluationActive) {
      // Stream already running — just subscribe to events
      setListening(true);
      return;
    }
    const start = async () => {
      await startEvaluation(selectedDevice);
      setListening(true);
    };
    start();
    return () => {
      if (!evaluationActive) {
        stopEvaluation();
      }
      setListening(false);
    };
  }, [open, selectedDevice, evaluationActive]);

  // Subscribe to spectrum events
  useEffect(() => {
    if (!open || !listening) return;
    let cancelled = false;
    onAudioSpectrum((s) => {
      if (!cancelled) {
        setSpectrum(s);
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else unlistenRef.current = unlisten;
    });
    return () => {
      cancelled = true;
      if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
    };
  }, [open, listening]);

  const handleDeviceChange = useCallback(async (deviceName: string) => {
    onDeviceChange(deviceName);
    await storeSave("evaluationDevice", deviceName);
    if (listening) {
      await stopEvaluation();
      await startEvaluation(deviceName || undefined);
    }
    // Restore saved gain for new device
    const savedGain = await storeLoad<number>(`inputGain_${deviceName || "__default"}`);
    const gain = savedGain ?? 0;
    setInputGainDb(gain);
    setInputGain(gain);
    // Reset recording state on device change
    setRecState("idle");
    setWaveform([]);
  }, [listening, onDeviceChange]);

  const handleGainChange = useCallback((db: number) => {
    setInputGainDb(db);
    storeSave(`inputGain_${selectedDevice ?? "__default"}`, db);
    setInputGain(db);
  }, [selectedDevice]);

  // ─── Recording ──────────────────────────────────────────────

  const handleRecord = useCallback(async () => {
    await startRecording();
    setRecState("recording");
    setRecElapsed(0);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setRecElapsed(elapsed);
      if (elapsed >= 10) {
        // Auto-stop at 10 seconds
        handleStopRecording();
      }
    }, 100);
  }, []);

  const handleStopRecording = useCallback(async () => {
    clearInterval(timerRef.current);
    const duration = await stopRecording();
    setRecDuration(duration);
    const wf = await getWaveform();
    setWaveform(wf);
    setRecState("recorded");
  }, []);

  const handlePlay = useCallback(async () => {
    setRecState("playing");
    setPlayProgress(0);
    await startPlayback();
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setPlayProgress(Math.min(elapsed / recDuration, 1));
    }, 50);
    // Listen for playback finished
    onPlaybackFinished(() => {
      clearInterval(timerRef.current);
      setPlayProgress(0);
      setRecState("recorded");
    }).then((unlisten) => {
      playbackUnlistenRef.current = unlisten;
    });
  }, [recDuration]);

  const handleStopPlayback = useCallback(async () => {
    clearInterval(timerRef.current);
    await stopPlayback();
    setPlayProgress(0);
    setRecState("recorded");
  }, []);

  const handleDiscard = useCallback(async () => {
    await discardRecording();
    setRecState("idle");
    setWaveform([]);
    setRecDuration(0);
  }, []);

  if (!open) return null;

  const rawRms = spectrum?.rms ?? 0;

  // Smooth RMS with EMA for stable dB readout
  const alpha = 0.3; // lower = smoother
  smoothRmsRef.current = smoothRmsRef.current * (1 - alpha) + rawRms * alpha;
  const rms = smoothRmsRef.current;

  const dbValue = rms > 0.0001 ? 20 * Math.log10(rms) : -60;
  const dbClamped = Math.max(-60, Math.min(0, dbValue));
  const levelPct = ((dbClamped + 60) / 60) * 100;
  const bands = spectrum?.bands ?? new Array(16).fill(0);

  // Debounce signal status — require 500ms of consistent state before switching
  const signalNow = rawRms > 0.01;
  if (signalNow !== hasSignal) {
    if (!signalTimerRef.current) {
      signalTimerRef.current = setTimeout(() => {
        setHasSignal(signalNow);
        signalTimerRef.current = undefined;
      }, signalNow ? 100 : 800); // fast on, slow off
    }
  } else {
    if (signalTimerRef.current) {
      clearTimeout(signalTimerRef.current);
      signalTimerRef.current = undefined;
    }
  }

  return (
    <div className="input-test-modal-overlay" onClick={onClose}>
      <div className="input-test-modal" onClick={(e) => e.stopPropagation()}>
        <div className="input-test-modal-header">
          <h3>Test Audio Input</h3>
          <button className="input-test-modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="input-test-modal-body">
          <div className="input-test-device-row">
            <label className="input-test-label">Device</label>
            <InputDeviceDropdown
              devices={devices}
              value={selectedDevice ?? ""}
              onChange={handleDeviceChange}
            />
          </div>

          <div className="input-test-gain-section">
            <div className="input-test-meter-label">
              <span>Sensitivity</span>
              <span className="input-test-db">{inputGainDb > 0 ? `+${inputGainDb}` : inputGainDb} dB</span>
            </div>
            <input
              type="range"
              className="input-test-gain-slider"
              min={0}
              max={40}
              step={1}
              value={inputGainDb}
              onChange={(e) => handleGainChange(Number(e.target.value))}
            />
          </div>

          <div className="input-test-meter-section">
            <div className="input-test-meter-label">
              <span>Level</span>
              <span className="input-test-db">{dbClamped > -59 ? `${Math.round(dbClamped)} dB` : "-\u221E dB"}</span>
            </div>
            <div className="input-test-meter-track">
              <div
                className={`input-test-meter-fill ${levelPct > 90 ? "clipping" : levelPct > 70 ? "hot" : ""}`}
                style={{ width: `${levelPct}%` }}
              />
              <div className="input-test-meter-ticks">
                <span>-60</span>
                <span>-40</span>
                <span>-20</span>
                <span>0 dB</span>
              </div>
            </div>
          </div>

          <div className="input-test-spectrum-section">
            <div className="input-test-meter-label">
              <span>Frequency</span>
            </div>
            <div className="input-test-spectrum">
              {bands.map((level, i) => (
                <div key={i} className="input-test-spectrum-col">
                  <div
                    className={`input-test-spectrum-bar ${level > 0.8 ? "hot" : ""}`}
                    style={{ height: `${level * 100}%` }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ─── Record / Playback section ─── */}
          <div className="input-test-rec-section">
            <div className="input-test-meter-label">
              <span>Record &amp; Playback</span>
              <span className="input-test-rec-time">
                {recState === "recording" ? `${recElapsed.toFixed(1)}s / 10s` :
                 (recState === "recorded" || recState === "playing") ? `${recDuration.toFixed(1)}s` :
                 "\u00A0"}
              </span>
            </div>

            {/* Fixed-height area for waveform / progress bar */}
            <div className="input-test-rec-display">
              {(recState === "recorded" || recState === "playing") && waveform.length > 0 ? (
                <div className="input-test-waveform">
                  <div className="input-test-waveform-bars">
                    {waveform.map((level, i) => (
                      <div key={i} className="input-test-waveform-col">
                        <div
                          className={`input-test-waveform-bar ${
                            recState === "playing" && i / waveform.length <= playProgress ? "played" : ""
                          }`}
                          style={{ height: `${Math.max(level * 100, 2)}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  {recState === "playing" && (
                    <div
                      className="input-test-waveform-cursor"
                      style={{ left: `${playProgress * 100}%` }}
                    />
                  )}
                </div>
              ) : recState === "recording" ? (
                <div className="input-test-rec-progress">
                  <div
                    className="input-test-rec-progress-fill"
                    style={{ width: `${(recElapsed / 10) * 100}%` }}
                  />
                </div>
              ) : (
                <div className="input-test-rec-empty" />
              )}
            </div>

            {/* Controls — always visible, disabled by state */}
            <div className="input-test-rec-controls">
              <button
                className="input-test-rec-btn record"
                onClick={recState === "recording" ? handleStopRecording : handleRecord}
                disabled={recState === "playing"}
              >
                {recState === "recording" ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="2" y="2" width="12" height="12" rx="1.5" />
                    </svg>
                    Stop
                  </>
                ) : (
                  <>
                    <span className="input-test-rec-dot" />
                    Record
                  </>
                )}
              </button>
              <button
                className="input-test-rec-btn play"
                onClick={recState === "playing" ? handleStopPlayback : handlePlay}
                disabled={recState !== "recorded" && recState !== "playing"}
              >
                {recState === "playing" ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="2" y="2" width="12" height="12" rx="1.5" />
                    </svg>
                    Stop
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4 2.5a.5.5 0 0 1 .77-.42l9 5.5a.5.5 0 0 1 0 .84l-9 5.5A.5.5 0 0 1 4 13.5z" />
                    </svg>
                    Play
                  </>
                )}
              </button>
              <button
                className="input-test-rec-btn discard"
                onClick={handleDiscard}
                disabled={recState !== "recorded" && recState !== "playing"}
              >
                Discard
              </button>
            </div>
          </div>

          <div className={`input-test-status ${hasSignal ? "active" : ""}`}>
            <span className={`input-test-status-dot ${hasSignal ? "connected" : ""}`} />
            {hasSignal ? "Signal detected \u2014 your input is working" : "No signal \u2014 play your instrument or make noise"}
          </div>
        </div>
      </div>
    </div>
  );
}

function InputDeviceDropdown({
  devices,
  value,
  onChange,
}: {
  devices: AudioInputDevice[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => [
      { value: "", label: "System default" },
      ...devices.map((d) => ({
        value: d.name,
        label: d.name + (d.isDefault ? " (default)" : ""),
      })),
    ],
    [devices],
  );

  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className={`midi-dropdown ${open ? "open" : ""}`} ref={ref} style={{ flex: 1 }}>
      <button
        className="midi-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="midi-dropdown-value">
          <span className={`midi-dropdown-dot ${value ? "connected" : ""}`} />
          {selected.label}
        </span>
        <svg
          className="midi-dropdown-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="midi-dropdown-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`midi-dropdown-item ${opt.value === value ? "selected" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              type="button"
            >
              {opt.value === value && (
                <svg
                  className="midi-dropdown-check"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
