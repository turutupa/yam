import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag } from "../hooks/useDrag";
import {
  formatGamepadButton,
  isGamepadBinding,
  useGamepad,
} from "../hooks/useGamepad";
import { useMidi } from "../hooks/useMidi";
import { useMetronome } from "../hooks/useMetronome";
import { useTapTempo } from "../hooks/useTapTempo";
import {
  checkForUpdate,
  configureSpeedRamp,
  downloadAndInstallUpdate,
  getActiveTab,
  onFullscreenChanged,
  openUrl,
  setActiveTab,
  setAlwaysOnTop,
  setBpm,
  setPlaying,
  setSoundType,
  setSubdivision,
  setTheme,
  setTimeSignature,
  setVolume,
  setWidgetAlwaysOnTop,
  setWidgetMode,
  showFloating,
  startSpeedRamp,
  stopSpeedRamp,
  storeLoad,
  storeSave,
  togglePlayback,
  listAudioOutputDevices,
  setAudioOutputDevice,
  onAudioDevicesChanged,
  getModelStatus,
  downloadModelFile,
  writeModelChunk,
  deleteModels,
} from "../ipc";
import type { ModelStatus, DownloadProgress } from "../ipc";
import CoachCard from "./CoachCard";
import type { FeedMessage } from "../types";
import "../styles/main-window.css";
import "../styles/transitions.css";
import "../styles/evaluation.css";
import { THEMES } from "../themes";
import type { AudioInputDevice, AudioOutputDevice, Preset, Subdivision, WidgetMode } from "../types";
import { DrillView } from "./DrillView";
import { FullscreenView } from "./FullscreenView";
import { PresetSidebar } from "./PresetSidebar";
import type { PresetSidebarHandle } from "./PresetSidebar";
import { ThemeEffects } from "./ThemeEffects";
import { TrackView } from "./TrackView";
import { ViewTransition } from "./ViewTransition";
import { ZenTransition } from "./ZenTransition";
import { useEvaluation } from "../hooks/useEvaluation";
import DriftMeter from "./DriftMeter";
import AudioInputTestModal from "./AudioInputTestModal";
import SettingsTimeline from "./SettingsTimeline";
import "../styles/audio-input-test.css";

// Force the webview to reclaim keyboard focus after macOS fullscreen exit.
// The hidden-input trick is the only reliable way — body.focus()/click() don't work.
async function forceWebviewFocus(retries = 4, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    if (document.hasFocus()) break;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const tmp = document.createElement("input");
  tmp.style.position = "fixed";
  tmp.style.opacity = "0";
  tmp.style.pointerEvents = "none";
  document.body.appendChild(tmp);
  tmp.focus();
  tmp.remove();
}

const SHARE_URL = "https://turutupa.github.io/yames/";
const SHARE_TEXT =
  "Check out Yames — a free open-source metronome for serious practice 🎵";
const SHARE_OPTIONS = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    url: `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + "\n" + SHARE_URL)}`,
  },
  {
    id: "x",
    label: "X / Twitter",
    url: `https://x.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    url: `https://www.reddit.com/submit?url=${encodeURIComponent(SHARE_URL)}&title=${encodeURIComponent(SHARE_TEXT)}`,
  },
  { id: "copy", label: "Copy link", url: "" },
] as const;

const SOUND_TYPES = [
  { id: "click", name: "Click", icon: "○" },
  { id: "wood", name: "Wood", icon: "◆" },
  { id: "beep", name: "Beep", icon: "◉" },
  { id: "drum", name: "Drum", icon: "◎" },
];

const TIME_SIGNATURES = [
  { beats: 0, label: "Never" },
  { beats: 1, label: "Always" },
  { beats: 2, label: "2/4" },
  { beats: 3, label: "3/4" },
  { beats: 4, label: "4/4" },
  { beats: 5, label: "5/4" },
  { beats: 6, label: "6/8" },
  { beats: 7, label: "7/8" },
];

const TEMPO_MARKINGS: [number, string][] = [
  [20, "Grave"],
  [40, "Largo"],
  [45, "Lento"],
  [55, "Adagio"],
  [66, "Adagietto"],
  [72, "Andante"],
  [80, "Andantino"],
  [84, "Moderato"],
  [100, "Allegretto"],
  [112, "Allegro"],
  [132, "Vivace"],
  [140, "Presto"],
  [178, "Prestissimo"],
];

function getTempoMarking(bpm: number): string {
  for (let i = TEMPO_MARKINGS.length - 1; i >= 0; i--) {
    if (bpm >= TEMPO_MARKINGS[i][0]) return TEMPO_MARKINGS[i][1];
  }
  return TEMPO_MARKINGS[0][1];
}

// SVG subdivision icons — clean musical note representations
function SubdivisionIcon({ sub, size = 20 }: { sub: Subdivision; size?: number }) {
  const h = size;
  const w = Math.round(size * 0.9);
  const noteColor = "currentColor";
  switch (sub) {
    case 1: // Quarter note — single stem + filled head
      return (
        <svg width={w} height={h} viewBox="0 0 18 24" fill={noteColor}>
          <ellipse cx="7" cy="20" rx="5" ry="3.5" transform="rotate(-15 7 20)" />
          <rect x="11" y="2" width="1.8" height="18" rx="0.9" />
        </svg>
      );
    case 2: // Eighth notes — two beamed
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.5" rx="1" />
        </svg>
      );
    case 3: // Triplet — three beamed
      return (
        <svg width={Math.round(size * 1.1)} height={h} viewBox="0 0 30 24" fill={noteColor}>
          <ellipse cx="4" cy="20" rx="3.8" ry="3" transform="rotate(-15 4 20)" />
          <ellipse cx="14" cy="20" rx="3.8" ry="3" transform="rotate(-15 14 20)" />
          <ellipse cx="24" cy="20" rx="3.8" ry="3" transform="rotate(-15 24 20)" />
          <rect x="7" y="4" width="1.6" height="16" rx="0.8" />
          <rect x="17" y="4" width="1.6" height="16" rx="0.8" />
          <rect x="27" y="4" width="1.6" height="16" rx="0.8" />
          <rect x="7" y="4" width="21.6" height="2.2" rx="1" />
        </svg>
      );
    case 4: // 16th notes — two stems with double beam
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.2" rx="1" />
          <rect x="8.5" y="7.5" width="13.3" height="2.2" rx="1" />
        </svg>
      );
    case 5: // Quintuplet — beamed pair
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.2" rx="1" />
        </svg>
      );
    case 6: // Sextuplet — double beam
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.2" rx="1" />
          <rect x="8.5" y="7.5" width="13.3" height="2.2" rx="1" />
        </svg>
      );
  }
}

const SUBDIVISION_NAMES: Record<Subdivision, string> = {
  1: "Quarter",
  2: "Eighth",
  3: "Triplet",
  4: "16th",
  5: "Quintuplet",
  6: "Sextuplet",
};

type HotkeyAction =
  | "play"
  | "bpm-down"
  | "bpm-up"
  | "bpm-down-1"
  | "bpm-up-1"
  | "sub-next"
  | "sub-prev"
  | "sig-next"
  | "sig-prev"
  | "fullscreen"
  | "os-fullscreen"
  | "toggle-widget"
  | "toggle-sidebar"
  | "tab-1"
  | "tab-2"
  | "tab-3"
  | "settings";

interface HotkeyEntry {
  action: string;
  key: string;
  globalKey?: string;
  id: HotkeyAction;
  desc: string;
  globalAllowed?: boolean;
  group: "metronome" | "view" | "navigation";
}

const IS_MAC = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

/** Convert macOS-style symbols to platform-appropriate labels */
function platformKey(key: string): string {
  if (IS_MAC) return key;
  return key
    .replace(/⌘/g, "Ctrl")
    .replace(/⇧/g, "Shift")
    .replace(/⌥/g, "Alt")
    .replace(/Ctrl\+?/g, "Ctrl+")
    .replace(/Shift\+?/g, "Shift+")
    .replace(/Alt\+?/g, "Alt+")
    .replace(/\+$/g, "");
}

/** Convert a KeyboardEvent to a normalized binding string */
function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  const cmdMod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (cmdMod) parts.push("⌘");
  if (IS_MAC && e.ctrlKey) parts.push("⌃");
  if (e.altKey) parts.push("⌥");
  if (e.shiftKey) parts.push("⇧");
  const key = e.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return parts.join("");
  switch (key) {
    case " ":
      parts.push("Space");
      break;
    case "ArrowUp":
      parts.push("↑");
      break;
    case "ArrowDown":
      parts.push("↓");
      break;
    case "ArrowLeft":
      parts.push("←");
      break;
    case "ArrowRight":
      parts.push("→");
      break;
    default:
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      break;
  }
  return parts.join("");
}

const HOTKEYS: HotkeyEntry[] = [
  {
    id: "play",
    action: "Play / Stop",
    key: "Space",
    globalKey: "⌘⇧Space",
    desc: "Start or stop the metronome",
    globalAllowed: true,
    group: "metronome",
  },
  {
    id: "bpm-up",
    action: "BPM +5",
    key: "↑",
    globalKey: "⌘⇧↑",
    desc: "Increase tempo by 5 BPM",
    globalAllowed: true,
    group: "metronome",
  },
  {
    id: "bpm-down",
    action: "BPM −5",
    key: "↓",
    globalKey: "⌘⇧↓",
    desc: "Decrease tempo by 5 BPM",
    globalAllowed: true,
    group: "metronome",
  },
  {
    id: "bpm-up-1",
    action: "BPM +1",
    key: "⇧↑",
    globalKey: "⌘⇧⌥↑",
    desc: "Fine increase by 1 BPM",
    globalAllowed: true,
    group: "metronome",
  },
  {
    id: "bpm-down-1",
    action: "BPM −1",
    key: "⇧↓",
    globalKey: "⌘⇧⌥↓",
    desc: "Fine decrease by 1 BPM",
    globalAllowed: true,
    group: "metronome",
  },
  {
    id: "sub-next",
    action: "Subdivision +",
    key: "]",
    desc: "Cycle to next subdivision",
    group: "metronome",
  },
  {
    id: "sub-prev",
    action: "Subdivision −",
    key: "[",
    desc: "Cycle to previous subdivision",
    group: "metronome",
  },
  {
    id: "sig-next",
    action: "Time signature +",
    key: "T",
    desc: "Cycle to next time signature",
    group: "metronome",
  },
  {
    id: "sig-prev",
    action: "Time signature −",
    key: "⇧T",
    desc: "Cycle to previous time signature",
    group: "metronome",
  },
  {
    id: "fullscreen",
    action: "Zen toggle",
    key: "Z",
    desc: "Enter or exit zen mode",
    group: "view",
  },
  {
    id: "os-fullscreen",
    action: "OS Fullscreen",
    key: "F",
    desc: "Toggle native fullscreen",
    group: "view",
  },
  {
    id: "toggle-widget",
    action: "Toggle Widget",
    key: "W",
    globalKey: "⌘⇧O",
    desc: "Switch to floating widget",
    globalAllowed: true,
    group: "navigation",
  },
  {
    id: "tab-1",
    action: "Metronome tab",
    key: "⌘1",
    desc: "Switch to Metronome tab",
    group: "navigation",
  },
  {
    id: "tab-2",
    action: "Drill tab",
    key: "⌘2",
    desc: "Switch to Drill tab",
    group: "navigation",
  },
  {
    id: "tab-3",
    action: "Pocket Check tab",
    key: "⌘3",
    desc: "Switch to Pocket Check tab",
    group: "navigation",
  },
  {
    id: "settings",
    action: "Settings",
    key: "⌘,",
    desc: "Open or close settings",
    group: "navigation",
  },
  {
    id: "toggle-sidebar",
    action: "Toggle Presets",
    key: "B",
    desc: "Open or close the presets sidebar",
    group: "navigation",
  },
];

const HOTKEY_GROUPS: { key: string; label: string }[] = [
  { key: "metronome", label: "Metronome" },
  { key: "view", label: "View" },
  { key: "navigation", label: "Navigation" },
];

// Delay for macOS fullscreen exit animation to complete before restoring window state
const FULLSCREEN_EXIT_DELAY = 600;

function splitCombo(combo: string): string[] {
  const parts: string[] = [];
  let i = 0;
  const modifiers = new Set(["⌘", "⌃", "⌥", "⇧", "↑", "↓", "←", "→"]);
  while (i < combo.length) {
    if (modifiers.has(combo[i])) {
      parts.push(combo[i]);
      i++;
    } else {
      // Rest of the string is the key name (e.g. "Space", "Tab", "F1", or single char)
      parts.push(combo.slice(i));
      break;
    }
  }
  return parts;
}

// Custom themed dropdown for MIDI device selection
function MidiDeviceDropdown({
  devices,
  value,
  onChange,
}: {
  devices: { id: number; name: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => [
      { value: "", label: "None" },
      ...devices.map((d) => ({ value: d.name, label: d.name })),
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
    <div className={`midi-dropdown ${open ? "open" : ""}`} ref={ref}>
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
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Custom themed dropdown for audio output device selection
function AudioOutputDropdown({
  devices,
  value,
  onChange,
}: {
  devices: AudioOutputDevice[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => [
      { value: "", label: "System default", isBluetooth: false },
      ...devices.map((d) => ({
        value: d.name,
        label: d.name + (d.isDefault ? " (default)" : ""),
        isBluetooth: d.isBluetooth,
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
    <div className={`midi-dropdown ${open ? "open" : ""}`} ref={ref}>
      <button
        className="midi-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="midi-dropdown-value">
          {selected.isBluetooth && (
            <svg className="midi-dropdown-dot bluetooth" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6.5 6.5 17.5 17.5" />
              <polyline points="17.5 6.5 6.5 17.5" />
              <path d="M6.5 17.5l5.5-5.5 5.5-5.5-5.5-5.5v22l5.5-5.5" />
            </svg>
          )}
          {!selected.isBluetooth && (
            <span className={`midi-dropdown-dot ${value ? "connected" : ""}`} />
          )}
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
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span>{opt.label}</span>
              {opt.isBluetooth && (
                <span className="audio-output-bt-badge">BT</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AudioInputDropdown({
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
    <div className={`midi-dropdown ${open ? "open" : ""}`} ref={ref}>
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
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MainWindow() {
  useDrag();
  const { state, currentBeat } = useMetronome();
  const evaluation = useEvaluation();
  const [inputTestOpen, setInputTestOpen] = useState(false);
  // Practice Coach model state
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelDownloading, setModelDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloadingTier, setDownloadingTier] = useState<"standard" | "full" | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);
  const [coachBrainTier, setCoachBrainTier] = useState<"off" | "standard" | "full">("off");
  const [coachVoiceMode, setCoachVoiceMode] = useState<"silent" | "chime" | "voice">("silent");
  const [coachNotifLevel, setCoachNotifLevel] = useState<"all" | "important" | "silent">("all");
  const [pendingDownloadTier, setPendingDownloadTier] = useState<"standard" | "full" | null>(null);
  // Coach card state
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachActive, setCoachActive] = useState(false);
  const [coachMessages, setCoachMessages] = useState<FeedMessage[]>([]);
  const [view, setViewRaw] = useState<"beat" | "drill" | "track" | "settings">(
    "beat",
  );
  const prevTab = useRef<"beat" | "drill" | "track">("beat");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOsFullscreen, setIsOsFullscreen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTooltip, setShareTooltip] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Persist tab changes and wrap setView
  const setView = useCallback(
    (v: "beat" | "drill" | "track" | "settings") => {
      setViewRaw((prev) => {
        // Stop playback when leaving the current tab
        if (prev !== v && prev !== "settings" && v !== "settings") {
          if (state.isPlaying) setPlaying(false);
          if (state.speedRamp?.active) stopSpeedRamp();
        }
        // Stop the drill if leaving the drill tab to settings
        if (prev === "drill" && v === "settings" && state.speedRamp?.active) {
          stopSpeedRamp();
        }
        return v;
      });
      if (v !== "settings") {
        setActiveTab(v);
      }
      if (v === "track" || v === "settings") {
        setTimeout(() => contentRef.current?.scrollTo(0, 0), 0);
      }
    },
    [state.speedRamp?.active, state.isPlaying],
  );

  // Close share popover on outside click
  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (shareRef.current?.contains(target)) return;
      if (shareBtnRef.current?.contains(target)) return;
      setShareOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareOpen]);

  const handleShareOption = (opt: (typeof SHARE_OPTIONS)[number]) => {
    if (opt.id === "copy") {
      navigator.clipboard.writeText(SHARE_URL).then(() => {
        setShareTooltip(true);
        setTimeout(() => setShareTooltip(false), 1800);
      });
    } else {
      openUrl(opt.url);
    }
    setShareOpen(false);
  };

  // Restore last active tab on mount
  useEffect(() => {
    getActiveTab().then((tab) => {
      if (tab === "beat" || tab === "drill" || tab === "track") {
        setViewRaw(tab);
        prevTab.current = tab;
      }
    });
  }, []);
  const [soundOpen, setSoundOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<PresetSidebarHandle>(null);
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [presetDirty, setPresetDirty] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState(false);
  const updateFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleActivePresetChange = useCallback((preset: Preset | null, dirty: boolean) => {
    setActivePreset(preset);
    setPresetDirty(dirty);
  }, []);

  const handlePresetSave = useCallback(() => {
    setSidebarOpen(true);
    // Small delay so the sidebar slide-in finishes before the input appears
    setTimeout(() => sidebarRef.current?.triggerAdd(), 150);
  }, []);

  const handlePresetUpdate = useCallback(() => {
    sidebarRef.current?.triggerUpdate();
    if (updateFeedbackTimer.current) clearTimeout(updateFeedbackTimer.current);
    setUpdateFeedback(true);
    updateFeedbackTimer.current = setTimeout(() => setUpdateFeedback(false), 1800);
  }, []);



  const [keyBindings, setKeyBindings] = useState<Record<string, string>>(() =>
    Object.fromEntries(HOTKEYS.map((hk) => [hk.id, hk.key])),
  );
  const [footBindings, setFootBindings] = useState<Record<string, string>>({});
  const [globalBindings, setGlobalBindings] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        HOTKEYS.filter((hk) => hk.globalAllowed).map((hk) => [
          hk.id,
          hk.globalKey || hk.key,
        ]),
      ),
  );
  const [bindingFor, setBindingFor] = useState<{
    id: string;
    type: "key" | "global";
  } | null>(null);
  const bindingsLoaded = useRef(false);

  // Unified input tester
  const [inputTestMode, setInputTestMode] = useState(false);
  const [inputTestLog, setInputTestLog] = useState<Array<{
    source: "keyboard" | "midi" | "gamepad";
    label: string;
    detail?: string;
    action?: string;
  }>>([]);
  const inputTestLogRef = useRef<HTMLDivElement>(null);

  // Keyboard conflict confirmation state
  const [pendingKeyConflict, setPendingKeyConflict] = useState<{
    combo: string;
    conflictAction: string;
    conflictActionLabel: string;
    targetAction: string;
    targetActionLabel: string;
    type: "key" | "global";
  } | null>(null);

  // Persist bindings whenever they change — but only after initial restore
  useEffect(() => {
    if (bindingsLoaded.current) storeSave("keyBindings", keyBindings);
  }, [keyBindings]);
  useEffect(() => {
    if (bindingsLoaded.current) storeSave("globalBindings", globalBindings);
  }, [globalBindings]);
  useEffect(() => {
    if (bindingsLoaded.current) storeSave("footBindings", footBindings);
  }, [footBindings]);

  // Restore bindings from store on mount, merging with defaults for any new hotkeys
  useEffect(() => {
    const defaults = Object.fromEntries(HOTKEYS.map((hk) => [hk.id, hk.key]));
    const globalDefaults = Object.fromEntries(
      HOTKEYS.filter((hk) => hk.globalAllowed).map((hk) => [
        hk.id,
        hk.globalKey || hk.key,
      ]),
    );
    (async () => {
      const kb = await storeLoad<Record<string, string>>("keyBindings");
      if (kb && typeof kb === "object") setKeyBindings({ ...defaults, ...kb });
      const gb = await storeLoad<Record<string, string>>("globalBindings");
      if (gb && typeof gb === "object")
        setGlobalBindings({ ...globalDefaults, ...gb });
      const fb = await storeLoad<Record<string, string>>("footBindings");
      if (fb && typeof fb === "object") setFootBindings(fb);
      bindingsLoaded.current = true;
    })();
  }, []);

  const [buttonFlash, setButtonFlash] = useState(true);
  const [activeBorder, setActiveBorder] = useState(true);
  const [drillAutoCollapse, setDrillAutoCollapse] = useState(true);
  const [viewTransitions, setViewTransitions] = useState<"off" | "subtle" | "smooth" | "expressive">("off");
  const [animationStyle, setAnimationStyle] = useState<"fade" | "scale" | "blur" | "slide" | "reveal">("scale");
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "up-to-date" | "downloading"
  >("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [appVersion, setAppVersion] = useState("0.0.0");

  const doUpdateCheck = useCallback(async () => {
    setUpdateStatus("checking");
    try {
      const ver = appVersion === "0.0.0" ? await getVersion() : appVersion;
      const result = await checkForUpdate(ver);
      if (result.hasUpdate) {
        setLatestVersion(result.latestVersion);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch {
      setUpdateStatus("idle");
    }
  }, [appVersion]);

  // Restore UI prefs from store on mount
  useEffect(() => {
    (async () => {
      const bf = await storeLoad<boolean>("buttonFlash");
      if (bf !== undefined) setButtonFlash(bf);
      const ab = await storeLoad<boolean>("activeBorder");
      if (ab !== undefined) setActiveBorder(ab);
      const dac = await storeLoad<boolean>("drillAutoCollapse");
      if (dac !== undefined) setDrillAutoCollapse(dac);
      const vt = await storeLoad<string | boolean>("viewTransitions");
      if (vt !== undefined) {
        // Backwards compatibility: convert old boolean format
        if (typeof vt === "boolean") {
          setViewTransitions(vt ? "smooth" : "off");
        } else if (vt === "off" || vt === "subtle" || vt === "smooth" || vt === "expressive") {
          setViewTransitions(vt);
        }
      }
      const as = await storeLoad<string>("animationStyle");
      if (as && ["fade", "scale", "blur", "slide", "reveal"].includes(as)) {
        setAnimationStyle(as as any);
      }
      const acu = await storeLoad<boolean>("autoCheckUpdates");
      if (acu !== undefined) setAutoCheckUpdates(acu);

      // Load audio output devices and saved selection
      const devices = await listAudioOutputDevices();
      setAudioOutputDevices(devices);
      const savedDevice = await storeLoad<string>("audioOutputDevice");
      if (savedDevice) setSelectedOutputDevice(savedDevice);

      // Get app version and auto-check for updates
      const ver = await getVersion();
      setAppVersion(ver);
      const shouldAutoCheck = acu !== undefined ? acu : true;
      if (shouldAutoCheck) {
        const result = await checkForUpdate(ver);
        if (result.hasUpdate) {
          setLatestVersion(result.latestVersion);
          setUpdateStatus("available");
        }
      }
    })();
  }, []);

  // Auto-update audio output device list when devices change
  useEffect(() => {
    const unlisten = onAudioDevicesChanged((devices) => {
      setAudioOutputDevices(devices);
      // If selected device was removed, fall back to system default
      if (selectedOutputDevice && !devices.some(d => d.name === selectedOutputDevice)) {
        setSelectedOutputDevice("");
        setAudioOutputDevice(null);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [selectedOutputDevice]);

  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmEditValue, setBpmEditValue] = useState("");
  const bpmInputRef = useRef<HTMLInputElement>(null);
  // Tab switching and settings are handled by the unified dispatcher via keyBindings
  const soundDropdownRef = useRef<HTMLDivElement>(null);

  const beatsPerMeasure = state.timeSignature >= 2 ? state.timeSignature : 2;
  const activeBeat = currentBeat ? currentBeat.beat % beatsPerMeasure : -1;
  const activeSub = currentBeat ? currentBeat.subdivision : -1;
  const isDownbeat = currentBeat?.isDownbeat ?? false;

  // Pulse state for floating play button — triggers briefly on each downbeat
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (buttonFlash && isDownbeat && state.isPlaying) {
      setIsPulsing(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setIsPulsing(false), 180);
    }
  }, [currentBeat, buttonFlash]);

  const handleBpmChange = (value: number) => {
    const clamped = Math.max(20, Math.min(300, value));
    setBpm(clamped);
  };

  const { tap: tapTempo, tapCount, isActive: tapActive } = useTapTempo(handleBpmChange);

  const [tapPulse, setTapPulse] = useState(false);
  const tapPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTap = useCallback(() => {
    tapTempo();
    setTapPulse(false);
    requestAnimationFrame(() => {
      setTapPulse(true);
      if (tapPulseTimer.current) clearTimeout(tapPulseTimer.current);
      tapPulseTimer.current = setTimeout(() => setTapPulse(false), 300);
    });
  }, [tapTempo]);

  const handleLoadPreset = useCallback(async (preset: Preset) => {
    await setBpm(preset.bpm);
    await setSubdivision(preset.subdivision as Subdivision);
    await setTimeSignature(preset.timeSignature);
    await setSoundType(preset.soundType);
    await setVolume(preset.volume);
    if (preset.view === "drill" && preset.speedRamp) {
      await configureSpeedRamp({
        startBpm: preset.speedRamp.startBpm,
        targetBpm: preset.speedRamp.targetBpm,
        increment: preset.speedRamp.increment,
        decrement: preset.speedRamp.decrement,
        barsPerStep: preset.speedRamp.barsPerStep,
        beatsPerBar: preset.speedRamp.beatsPerBar,
        mode: preset.speedRamp.mode,
        cyclic: preset.speedRamp.cyclic,
        warmupBeats: preset.speedRamp.warmupBeats,
      });
    }
    if (preset.view === "drill" || preset.view === "beat") setView(preset.view);
  }, [setView]);

  const startBpmEdit = () => {
    setBpmEditValue(String(state.bpm));
    setEditingBpm(true);
    setTimeout(() => bpmInputRef.current?.select(), 0);
  };

  const commitBpmEdit = () => {
    const val = parseInt(bpmEditValue);
    if (!isNaN(val)) handleBpmChange(val);
    setEditingBpm(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!soundOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        soundDropdownRef.current &&
        !soundDropdownRef.current.contains(e.target as Node)
      ) {
        setSoundOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [soundOpen]);

  // Load Practice Coach settings from storage
  useEffect(() => {
    getModelStatus().then(setModelStatus);
    storeLoad<"off" | "standard" | "full">("coachBrainTier").then((v) => { if (v) setCoachBrainTier(v); });
    storeLoad<"silent" | "chime" | "voice">("coachVoiceMode").then((v) => { if (v) setCoachVoiceMode(v); });
    storeLoad<"all" | "important" | "silent">("coachNotifLevel").then((v) => { if (v) setCoachNotifLevel(v); });
  }, []);

  // Download model for a given tier
  const startModelDownload = useCallback(async (tier: "standard" | "full") => {
    const abort = new AbortController();
    downloadAbort.current = abort;
    setModelDownloading(true);
    setDownloadingTier(tier);
    setPendingDownloadTier(null);
    setDownloadError(null);
    setDownloadSuccess(false);
    setDownloadProgress({ component: "brain", downloadedBytes: 0, totalBytes: 0, fraction: 0, done: false });
    const modelUrls = {
      standard: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
      full: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    };
    const modelNames = { standard: "Qwen 2.5 1.5B", full: "Phi 3.5 Mini" };
    try {
      await downloadModelFile(
        modelUrls[tier],
        "brain",
        "model.bin",
        (downloaded, total) => setDownloadProgress({ component: modelNames[tier], downloadedBytes: downloaded, totalBytes: total, fraction: total > 0 ? downloaded / total : 0, done: false }),
        abort.signal,
      );
      const enc = new TextEncoder();
      await writeModelChunk("brain", "tier", Array.from(enc.encode(tier)));
      const status = await getModelStatus();
      setModelStatus(status);
      setCoachBrainTier(tier);
      storeSave("coachBrainTier", tier);
      setDownloadSuccess(true);
    } catch (err) {
      if (abort.signal.aborted) {
        // User cancelled — silently clear
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setDownloadError(msg);
      }
    }
    downloadAbort.current = null;
    setModelDownloading(false);
    setDownloadProgress(null);
    setDownloadingTier(null);
  }, []);

  // Format bytes helper
  const formatBytes = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }, []);

  // Listen for fullscreen changes from Rust (global shortcut)
  useEffect(() => {
    const unlisten = onFullscreenChanged(() => {
      if (view !== "track") setIsFullscreen((prev) => !prev);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [view]);

  // Track OS fullscreen state and restore always-on-top when exiting
  // (handles macOS Escape key which the app never receives)
  const wasOsFullscreen = useRef(false);
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onResized(async () => {
      const isFull = await win.isFullscreen();
      setIsOsFullscreen(isFull);
      // Exiting OS fullscreen — restore always-on-top and focus
      if (wasOsFullscreen.current && !isFull) {
        await new Promise((r) => setTimeout(r, FULLSCREEN_EXIT_DELAY));
        await win.setAlwaysOnTop(state.alwaysOnTop);
        await win.setFocus();
        await forceWebviewFocus();
      }
      wasOsFullscreen.current = isFull;
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [state.alwaysOnTop]);

  const [pendingKeys, setPendingKeys] = useState<string>("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const resetAllBindings = useCallback(() => {
    setKeyBindings(Object.fromEntries(HOTKEYS.map((hk) => [hk.id, hk.key])));
    setGlobalBindings(
      Object.fromEntries(
        HOTKEYS.filter((hk) => hk.globalAllowed).map((hk) => [
          hk.id,
          hk.globalKey || hk.key,
        ]),
      ),
    );
    setFootBindings({});
    setShowResetConfirm(false);
  }, []);

  // Key binding listener with conflict detection
  const handleBinding = useCallback(
    (e: KeyboardEvent) => {
      if (!bindingFor) return;
      e.preventDefault();
      if (e.key === "Escape") {
        setBindingFor(null);
        setPendingKeys("");
        return;
      }
      const combo = eventToCombo(e);
      if (combo) {
        setPendingKeys(combo);
      }
      if (combo && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
        // Check for conflict
        const source = bindingFor.type === "key" ? keyBindings : globalBindings;
        const conflictEntry = Object.entries(source).find(
          ([action, bound]) => bound === combo && action !== bindingFor.id,
        );
        if (conflictEntry) {
          const conflictHk = HOTKEYS.find((h) => h.id === conflictEntry[0]);
          const targetHk = HOTKEYS.find((h) => h.id === bindingFor.id);
          setPendingKeyConflict({
            combo,
            conflictAction: conflictEntry[0],
            conflictActionLabel: conflictHk?.action ?? conflictEntry[0],
            targetAction: bindingFor.id,
            targetActionLabel: targetHk?.action ?? bindingFor.id,
            type: bindingFor.type,
          });
          return; // Don't apply yet — wait for confirmation
        }
        // No conflict — apply immediately
        if (bindingFor.type === "key") {
          setKeyBindings((prev) => ({ ...prev, [bindingFor.id]: combo }));
        } else if (bindingFor.type === "global") {
          setGlobalBindings((prev) => ({ ...prev, [bindingFor.id]: combo }));
        }
        setBindingFor(null);
        setPendingKeys("");
      }
    },
    [bindingFor, keyBindings, globalBindings],
  );

  const handleResetBinding = useCallback(() => {
    if (!bindingFor) return;
    const hk = HOTKEYS.find((h) => h.id === bindingFor.id);
    if (bindingFor.type === "key") {
      setKeyBindings((prev) => ({ ...prev, [bindingFor.id]: hk?.key || "" }));
    } else if (bindingFor.type === "global") {
      setGlobalBindings((prev) => ({
        ...prev,
        [bindingFor.id]: hk?.globalKey || hk?.key || "",
      }));
    }
    setBindingFor(null);
    setPendingKeys("");
  }, [bindingFor]);

  const handleRemoveBinding = useCallback(() => {
    if (!bindingFor) return;
    if (bindingFor.type === "key") {
      setKeyBindings((prev) => ({ ...prev, [bindingFor.id]: "" }));
    } else if (bindingFor.type === "global") {
      setGlobalBindings((prev) => ({ ...prev, [bindingFor.id]: "" }));
    }
    setBindingFor(null);
    setPendingKeys("");
  }, [bindingFor]);

  const acceptKeyConflict = useCallback(() => {
    if (!pendingKeyConflict) return;
    const { combo, conflictAction, targetAction, type } = pendingKeyConflict;
    if (type === "key") {
      setKeyBindings((prev) => ({
        ...prev,
        [conflictAction]: "",
        [targetAction]: combo,
      }));
    } else {
      setGlobalBindings((prev) => ({
        ...prev,
        [conflictAction]: "",
        [targetAction]: combo,
      }));
    }
    setPendingKeyConflict(null);
    setBindingFor(null);
    setPendingKeys("");
  }, [pendingKeyConflict]);

  const rejectKeyConflict = useCallback(() => {
    setPendingKeyConflict(null);
    setPendingKeys("");
  }, []);

  useEffect(() => {
    if (!bindingFor || pendingKeyConflict) return;
    document.addEventListener("keydown", handleBinding);
    return () => document.removeEventListener("keydown", handleBinding);
  }, [bindingFor, handleBinding, pendingKeyConflict]);

  // Shared action dispatcher — called by keyboard handler and gamepad hook
  const dispatchAction = useCallback(
    (actionId: HotkeyAction) => {
      // Tab/settings/widget actions work from any view
      if (
        actionId === "tab-1" ||
        actionId === "tab-2" ||
        actionId === "tab-3" ||
        actionId === "settings" ||
        actionId === "toggle-widget" ||
        actionId === "toggle-sidebar"
      ) {
        switch (actionId) {
          case "tab-1":
            setView("beat");
            break;
          case "tab-2":
            setView("drill");
            break;
          case "tab-3":
            setView("track");
            break;
          case "settings":
            if (view === "settings") setView(prevTab.current);
            else {
              prevTab.current = view as "beat" | "drill" | "track";
              setView("settings");
            }
            break;
          case "toggle-widget":
            showFloating();
            break;
          case "toggle-sidebar":
            if (view === "beat" || view === "drill") setSidebarOpen((o) => !o);
            break;
        }
        return;
      }
      if (view === "settings") return;
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      switch (actionId) {
        case "play":
          if (view === "drill") {
            if (state.speedRamp?.active) {
              stopSpeedRamp();
            } else {
              startSpeedRamp();
            }
          } else if (view === "beat") {
            togglePlayback();
          }
          break;
        case "bpm-up":
          handleBpmChange(state.bpm + 5);
          break;
        case "bpm-down":
          handleBpmChange(state.bpm - 5);
          break;
        case "bpm-up-1":
          handleBpmChange(state.bpm + 1);
          break;
        case "bpm-down-1":
          handleBpmChange(state.bpm - 1);
          break;
        case "sub-next": {
          const subs: Subdivision[] = [1, 2, 3, 4, 5, 6];
          const idx = subs.indexOf(state.subdivision as Subdivision);
          setSubdivision(subs[(idx + 1) % subs.length]);
          break;
        }
        case "sub-prev": {
          const subs: Subdivision[] = [1, 2, 3, 4, 5, 6];
          const idx = subs.indexOf(state.subdivision as Subdivision);
          setSubdivision(subs[(idx - 1 + subs.length) % subs.length]);
          break;
        }
        case "sig-next": {
          const vals = TIME_SIGNATURES.map((t) => t.beats);
          const idx = vals.indexOf(state.timeSignature);
          setTimeSignature(vals[(idx + 1) % vals.length]);
          break;
        }
        case "sig-prev": {
          const vals = TIME_SIGNATURES.map((t) => t.beats);
          const idx = vals.indexOf(state.timeSignature);
          setTimeSignature(vals[(idx - 1 + vals.length) % vals.length]);
          break;
        }
        case "fullscreen":
          if (view !== "track") {
            if (isFullscreen) {
              (async () => {
                const win = getCurrentWindow();
                if (await win.isFullscreen()) {
                  await win.setFullscreen(false);
                  await new Promise((r) =>
                    setTimeout(r, FULLSCREEN_EXIT_DELAY),
                  );
                }
                setIsFullscreen(false);
                await win.setAlwaysOnTop(state.alwaysOnTop);
                await win.setFocus();
                await forceWebviewFocus();
              })();
            } else {
              setIsFullscreen(true);
            }
          }
          break;
        case "os-fullscreen": {
          (async () => {
            const win = getCurrentWindow();
            const isFull = await win.isFullscreen();
            await win.setFullscreen(!isFull);
            setIsOsFullscreen(!isFull);
            if (isFull) {
              await new Promise((r) => setTimeout(r, FULLSCREEN_EXIT_DELAY));
              await win.setAlwaysOnTop(state.alwaysOnTop);
              await win.setFocus();
              await forceWebviewFocus();
            }
          })();
          break;
        }
      }
    },
    [
      view,
      state.bpm,
      state.subdivision,
      state.timeSignature,
      state.speedRamp?.active,
      isFullscreen,
      setView,
      state.alwaysOnTop,
    ],
  );

  // Unified local hotkey dispatcher — reads from keyBindings
  useEffect(() => {
    if (bindingFor) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Escape: close tester > exit zen > exit settings
      if (e.key === "Escape") {
        if (inputTestMode) {
          setInputTestMode(false);
          return;
        }
        if (isFullscreen) {
          e.preventDefault();
          setIsFullscreen(false);
          return;
        }
        if (view === "settings") {
          e.preventDefault();
          setView(prevTab.current);
          return;
        }
      }
      const combo = eventToCombo(e);
      if (!combo) return;
      const actionId = Object.entries(keyBindings).find(
        ([_, key]) => key === combo,
      )?.[0] as HotkeyAction | undefined;
      // Feed tester if open
      if (inputTestMode) {
        if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
        e.preventDefault();
        const hk = actionId ? HOTKEYS.find((h) => h.id === actionId) : null;
        setInputTestLog((prev) => [...prev.slice(-99), {
          source: "keyboard" as const,
          label: combo,
          action: hk?.action,
        }]);
        requestAnimationFrame(() => {
          const el = inputTestLogRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
        return;
      }
      if (!actionId) return;
      e.preventDefault();
      dispatchAction(actionId);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [view, keyBindings, isFullscreen, bindingFor, setView, dispatchAction, inputTestMode]);

  // MIDI controller support
  const [midiAutoAccept, setMidiAutoAccept] = useState(false);
  const inputTestModeRef = useRef(false);
  useEffect(() => { inputTestModeRef.current = inputTestMode; }, [inputTestMode]);

  const midi = useMidi((action) => {
    if (inputTestModeRef.current) return;
    dispatchAction(action as HotkeyAction);
  }, midiAutoAccept, inputTestMode);

  // Accumulate MIDI activity into test log when test mode is on
  useEffect(() => {
    if (!midi.lastActivity) return;
    if (inputTestMode) {
      const activity = midi.lastActivity;
      const bound = midi.bindings.find(
        (b) => b.msgType === activity.type && b.number === activity.number && b.channel === activity.channel,
      );
      const hk = bound ? HOTKEYS.find((h) => h.id === bound.action) : null;
      setInputTestLog((prev) => [...prev.slice(-99), {
        source: "midi" as const,
        label: `${activity.type.toUpperCase()} #${activity.number}`,
        detail: `Ch${activity.channel + 1} Val${activity.value}`,
        action: hk?.action,
      }]);
      requestAnimationFrame(() => {
        const el = inputTestLogRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [inputTestMode, midi.lastActivity]);

  // Clear unified tester log when closed
  useEffect(() => {
    if (!inputTestMode) setInputTestLog([]);
  }, [inputTestMode]);

  // Gamepad / footswitch support (merged into MIDI column)
  useGamepad({
    enabled: true,
    onButtonPress:
      midi.learnMode
        ? (id) => {
            setFootBindings((prev) => ({ ...prev, [midi.learnMode!]: id }));
            midi.cancelLearn();
          }
        : inputTestMode
        ? (id) => {
            const actionId = Object.entries(footBindings).find(([_, b]) => b === id)?.[0];
            const hk = actionId ? HOTKEYS.find((h) => h.id === actionId) : null;
            setInputTestLog((prev) => [...prev.slice(-99), {
              source: "gamepad" as const,
              label: formatGamepadButton(id),
              action: hk?.action,
            }]);
            requestAnimationFrame(() => {
              const el = inputTestLogRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }
        : undefined,
    bindings: !midi.learnMode && !inputTestMode ? footBindings : undefined,
    onAction: !midi.learnMode && !inputTestMode
      ? (id) => dispatchAction(id as HotkeyAction)
      : undefined,
  });

  // Resize window based on current view
  const sliderPercent = ((state.bpm - 20) / (300 - 20)) * 100;
  const volumePercent = state.volume * 100;

  // Safety net: re-apply always-on-top and focus after any zen exit
  const prevFullscreen = useRef(false);
  useEffect(() => {
    if (prevFullscreen.current && !isFullscreen) {
      const win = getCurrentWindow();
      const timer = setTimeout(async () => {
        if (await win.isFullscreen()) {
          await win.setFullscreen(false);
          await new Promise((r) => setTimeout(r, FULLSCREEN_EXIT_DELAY));
        }
        // Retry setAlwaysOnTop — macOS can silently ignore it if the
        // fullscreen exit animation hasn't fully completed
        for (let i = 0; i < 3; i++) {
          await win.setAlwaysOnTop(state.alwaysOnTop);
          await new Promise((r) => setTimeout(r, 200));
        }
        await win.setFocus();
        await forceWebviewFocus();
      }, 100);
      return () => clearTimeout(timer);
    }
    prevFullscreen.current = isFullscreen;
  }, [isFullscreen, state.alwaysOnTop]);

  // Fullscreen zen mode — rendered as overlay via ZenTransition below
  const zenExitHandler = useCallback(async () => {
    const win = getCurrentWindow();
    if (await win.isFullscreen()) {
      await win.setFullscreen(false);
      await new Promise((r) => setTimeout(r, FULLSCREEN_EXIT_DELAY));
    }
    setIsFullscreen(false);
    // alwaysOnTop + focus handled by the effect above
  }, []);

  return (
    <>
    <ZenTransition isActive={isFullscreen} themeId={state.theme} disabled={viewTransitions === "off"} level={viewTransitions} animStyle={animationStyle}>
      <FullscreenView
        state={state}
        currentBeat={currentBeat}
        activeTab={view === "drill" ? "drill" : "beat"}
        onExit={zenExitHandler}
      />
    </ZenTransition>
    <div
      className={`main-window ${isOsFullscreen ? "os-fullscreen" : ""} ${IS_MAC ? "os-mac" : "os-other"}`}
      data-playing={state.isPlaying}
      data-border={activeBorder}
    >
      <ThemeEffects themeId={state.theme} currentBeat={currentBeat} isPlaying={state.isPlaying} />
      <header className="main-header">
        {view !== "settings" && (
          <nav className="tab-bar">
            <button
              className={`tab-btn ${view === "beat" ? "active" : ""}`}
              onClick={() => setView("beat")}
            >
              Metronome
            </button>
            <button
              className={`tab-btn ${view === "drill" ? "active" : ""}`}
              onClick={() => setView("drill")}
            >
              Drill
            </button>
            <button
              className={`tab-btn ${view === "track" ? "active" : ""}`}
              onClick={() => setView("track")}
            >
              Pocket Check
            </button>
          </nav>
        )}
        <div className="header-actions">
          {view !== "settings" && view !== "track" && (
            <button
              className="header-btn"
              onClick={() => setIsFullscreen(true)}
              data-tooltip="Zen"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22c4-4 8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 4 8 8 12z" />
                <path d="M12 2v20" />
                <path d="M4.5 10c2.5 1 5 1 7.5 0s5-1 7.5 0" />
              </svg>
            </button>
          )}
          {view !== "track" && (
            <div className="header-sound-wrap" ref={soundDropdownRef}>
              <button
                className="header-btn"
                onClick={() => setSoundOpen(!soundOpen)}
                data-tooltip={SOUND_TYPES.find((s) => s.id === state.soundType)?.name ?? "Click"}
              >
                <span className="header-sound-icon">{SOUND_TYPES.find((s) => s.id === state.soundType)?.icon ?? "○"}</span>
              </button>
              {soundOpen && (
                <div className="header-sound-menu">
                  {SOUND_TYPES.map((st) => (
                    <button
                      key={st.id}
                      className={`sub-dropdown-item ${state.soundType === st.id ? "active" : ""}`}
                      onClick={() => {
                        setSoundType(st.id);
                        setSoundOpen(false);
                      }}
                    >
                      <span className="sub-dropdown-icon">{st.icon}</span>
                      <span>{st.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="header-volume-wrap">
            <button className="header-btn header-volume-btn">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {state.volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
                {state.volume > 0.5 && (
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                )}
              </svg>
            </button>
            <div className="header-volume-popover">
              <input
                type="range"
                className="volume-slider"
                min={0}
                max={100}
                value={volumePercent}
                onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
                style={
                  { "--volume-pct": `${volumePercent}%` } as React.CSSProperties
                }
              />
            </div>
          </div>
          <button
            className="header-btn"
            onClick={() => showFloating()}
            data-tooltip="Open widget"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <rect x="10" y="10" width="10" height="10" rx="1" />
            </svg>
          </button>
          <div className="header-share-wrap" ref={shareRef}>
            <button
              ref={shareBtnRef}
              className="header-btn"
              onClick={() => setShareOpen(!shareOpen)}
              data-tooltip={
                shareTooltip ? "Copied!" : !shareOpen ? "Share" : undefined
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          </div>
          <button
            className={`header-btn ${view === "settings" ? "active" : ""}`}
            onClick={() => {
              if (view === "settings") {
                setView(prevTab.current);
              } else {
                prevTab.current = view as "beat" | "drill" | "track";
                setView("settings");
              }
            }}
            data-tooltip={view === "settings" ? "Back" : "Settings"}
          >
            {view === "settings" ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {shareOpen &&
        shareBtnRef.current &&
        (() => {
          const rect = shareBtnRef.current!.getBoundingClientRect();
          return (
            <div
              ref={shareRef}
              className="header-share-popover"
              style={{
                top: rect.bottom + 8,
                right: window.innerWidth - rect.right,
              }}
            >
              {SHARE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className="header-share-option"
                  onClick={() => handleShareOption(opt)}
                >
                  {opt.id === "whatsapp" && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                  )}
                  {opt.id === "x" && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  )}
                  {opt.id === "facebook" && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  )}
                  {opt.id === "reddit" && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
                    </svg>
                  )}
                  {opt.id === "copy" && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          );
        })()}

      <div className="main-body">
        {view !== "settings" && view !== "track" && (
          <PresetSidebar
            ref={sidebarRef}
            state={state}
            view={view === "beat" || view === "drill" ? view : "beat"}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen((o) => !o)}
            onLoadPreset={handleLoadPreset}
            onActiveChange={handleActivePresetChange}
            shortcut={platformKey(keyBindings["toggle-sidebar"] || "")}
          />
        )}
      <div
        ref={contentRef}
        className="main-content"
        data-view={view}
        onDoubleClick={(e) => {
          if (view !== "beat" && view !== "drill") return;
          if (
            (e.target as HTMLElement).closest(
              "button, input, select, a, .tab-bar, .drill-grid-cell",
            )
          )
            return;
          setIsFullscreen(true);
        }}
      >
        {(view === "beat" || view === "drill") && (
          <div className="preset-save-area">
            {activePreset && (
              <button
                className="preset-active-name"
                onClick={() => {
                  setSidebarOpen(true);
                  setTimeout(() => sidebarRef.current?.triggerRename(activePreset.id), 150);
                }}
                title="Rename preset"
              >
                {activePreset.name}{presetDirty ? " •" : ""}
              </button>
            )}
            {activePreset ? (
              <button
                className={`preset-save-btn preset-save-btn--update ${presetDirty ? "preset-save-btn--dirty" : ""} ${updateFeedback ? "preset-save-btn--feedback" : ""}`}
                onClick={handlePresetUpdate}
                title={presetDirty ? "Update preset" : "No changes to save"}
              >
                {updateFeedback ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="preset-save-btn-label">Updated!</span>
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v13M7 8l5-5 5 5" />
                      <path d="M5 20h14" />
                    </svg>
                    <span className="preset-save-btn-label">{presetDirty ? "Update" : "No changes"}</span>
                  </>
                )}
              </button>
            ) : (
              <button
                className="preset-save-btn preset-save-btn--save"
                onClick={handlePresetSave}
                title="Save preset"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                <span className="preset-save-btn-label">Save preset</span>
              </button>
            )}
          </div>
        )}
        <ViewTransition viewKey={view} themeId={state.theme} disabled={viewTransitions === "off"} level={viewTransitions} animStyle={animationStyle}>
        {view === "beat" ? (
          <>
            <section className="bpm-section">
              <button
                className={`tap-btn ${tapActive ? "active" : ""} ${tapPulse ? "pulse" : ""}`}
                onClick={handleTap}
              >
                TAP
                {tapActive && tapCount >= 2 && (
                  <span className="tap-count">{tapCount} taps</span>
                )}
              </button>
              <div className="bpm-display view-stagger-item" style={{ animationDelay: '0ms' }}>
                <button
                  className="bpm-btn"
                  onClick={() => handleBpmChange(state.bpm - 5)}
                >
                  −
                </button>
                {editingBpm ? (
                  <input
                    ref={bpmInputRef}
                    type="text"
                    inputMode="numeric"
                    className="bpm-input"
                    value={bpmEditValue}
                    onChange={(e) =>
                      setBpmEditValue(e.target.value.replace(/\D/g, ""))
                    }
                    onBlur={commitBpmEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitBpmEdit();
                      if (e.key === "Escape") setEditingBpm(false);
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="bpm-input bpm-clickable"
                    onClick={startBpmEdit}
                  >
                    {state.bpm}
                  </span>
                )}
                <button
                  className="bpm-btn"
                  onClick={() => handleBpmChange(state.bpm + 5)}
                >
                  +
                </button>
              </div>
              <div className="bpm-slider-wrap view-stagger-item" style={{ animationDelay: '40ms' }}>
                <input
                  type="range"
                  className="bpm-slider"
                  min={20}
                  max={300}
                  value={state.bpm}
                  onChange={(e) => handleBpmChange(parseInt(e.target.value))}
                  style={
                    {
                      "--slider-pct": `${sliderPercent}%`,
                    } as React.CSSProperties
                  }
                />
                <span className="tempo-marking">
                  {getTempoMarking(state.bpm)}
                </span>
              </div>
            </section>

            <section className="beat-section">
              <div className="main-beat-dots">
                {Array.from({ length: beatsPerMeasure }, (_, beatIdx) => {
                  const isBeatActive = activeBeat === beatIdx && isDownbeat;
                  const isBeatDownbeat = isBeatActive && beatIdx === 0;
                  const isAccentBeat =
                    state.timeSignature === 1 ||
                    (beatIdx === 0 && state.timeSignature >= 2);
                  // Feedback coloring when evaluation is active
                  const fb = evaluation.enabled && currentBeat
                    ? evaluation.dotFeedback.get(
                        // Map sequential beat index to measure position
                        currentBeat.beat - (activeBeat - beatIdx + beatsPerMeasure) % beatsPerMeasure
                      )
                    : undefined;
                  const feedbackClass = fb && isBeatActive
                    ? `feedback-${fb.classification}`
                    : "";
                  return (
                    <div key={beatIdx} className="main-dot-group" style={{ animationDelay: `${beatIdx * 40}ms` }}>
                      <div
                        className={`main-dot ${isBeatActive ? "active" : ""} ${isBeatDownbeat ? "downbeat" : ""} ${isAccentBeat && isBeatActive ? "accent" : ""} ${feedbackClass}`}
                      />
                      {state.subdivision > 1 && (
                        <div className="main-sub-dots">
                          {Array.from(
                            { length: state.subdivision - 1 },
                            (_, subIdx) => (
                              <div
                                key={subIdx}
                                className={`main-sub-dot ${
                                  activeBeat === beatIdx &&
                                  activeSub === subIdx + 1
                                    ? "active"
                                    : ""
                                }`}
                              />
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {evaluation.enabled && state.isPlaying && (
                <DriftMeter
                  lastFeedback={evaluation.lastFeedback}
                  avgDeviation={evaluation.avgDeviation}
                  visible={evaluation.enabled && state.isPlaying}
                />
              )}
            </section>

            <div className="sub-row">
              <span className="row-side-label">Subdiv</span>
              {([1, 2, 3, 4, 5, 6] as Subdivision[]).map((sub, i) => (
                <button
                  key={sub}
                  className={`sub-row-btn view-stagger-item ${state.subdivision === sub ? "active" : ""}`}
                  style={{ animationDelay: `${100 + i * 25}ms` }}
                  onClick={() => setSubdivision(sub)}
                  data-tooltip={SUBDIVISION_NAMES[sub]}
                >
                  <SubdivisionIcon sub={sub} size={18} />
                </button>
              ))}
            </div>

            <div className="time-sig-row">
              <span className="row-side-label">Meter</span>
              {TIME_SIGNATURES.map((ts, i) => (
                <button
                  key={ts.beats}
                  className={`time-sig-btn view-stagger-item ${state.timeSignature === ts.beats ? "active" : ""}`}
                  style={{ animationDelay: `${150 + i * 30}ms` }}
                  onClick={() => setTimeSignature(ts.beats)}
                >
                  {ts.label}
                </button>
              ))}
            </div>
          </>
        ) : view === "drill" ? (
          <DrillView
            state={state}
            currentBeat={currentBeat}
            autoCollapse={drillAutoCollapse}
            animations={viewTransitions !== "off"}
          />
        ) : view === "track" ? (
          <TrackView state={state} currentBeat={currentBeat} evaluationEnabled={evaluation.enabled} />
        ) : (
          <>
            {/* Update banner — shown at top of settings when update available */}
            {updateStatus === "available" && (
              <div
                className="update-banner"
                onClick={() => {
                  setUpdateStatus("downloading");
                  downloadAndInstallUpdate().catch(() => {
                    setUpdateStatus("available");
                  });
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Yames v{latestVersion || "0.6.0"} is available</span>
                <span className="update-banner-action">Install & Restart →</span>
              </div>
            )}
            {updateStatus === "downloading" && (
              <div className="update-banner update-banner-downloading">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Updating Yames…</span>
              </div>
            )}
            <section className="settings-section">
              <h2>General</h2>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Check for updates</label>
                  <span className="setting-hint">
                    Automatically check on launch
                  </span>
                </div>
                <button
                  className={`toggle-btn ${autoCheckUpdates ? "active" : ""}`}
                  onClick={() => {
                    const next = !autoCheckUpdates;
                    setAutoCheckUpdates(next);
                    storeSave("autoCheckUpdates", next);
                  }}
                >
                  {autoCheckUpdates ? "On" : "Off"}
                </button>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Always on top</label>
                  <span className="setting-hint">
                    Keep main window above other apps
                  </span>
                </div>
                <button
                  className={`toggle-btn ${state.alwaysOnTop ? "active" : ""}`}
                  onClick={() => setAlwaysOnTop(!state.alwaysOnTop)}
                >
                  {state.alwaysOnTop ? "On" : "Off"}
                </button>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Button flash</label>
                  <span className="setting-hint">
                    Flash play button on accents
                  </span>
                </div>
                <button
                  className={`toggle-btn ${buttonFlash ? "active" : ""}`}
                  onClick={() => {
                    const next = !buttonFlash;
                    setButtonFlash(next);
                    storeSave("buttonFlash", next);
                  }}
                >
                  {buttonFlash ? "On" : "Off"}
                </button>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Active border</label>
                  <span className="setting-hint">Show border when playing</span>
                </div>
                <button
                  className={`toggle-btn ${activeBorder ? "active" : ""}`}
                  onClick={() => {
                    const next = !activeBorder;
                    setActiveBorder(next);
                    storeSave("activeBorder", next);
                  }}
                >
                  {activeBorder ? "On" : "Off"}
                </button>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Drill auto-collapse</label>
                  <span className="setting-hint">
                    Collapse drill config while playing
                  </span>
                </div>
                <button
                  className={`toggle-btn ${drillAutoCollapse ? "active" : ""}`}
                  onClick={() => {
                    const next = !drillAutoCollapse;
                    setDrillAutoCollapse(next);
                    storeSave("drillAutoCollapse", next);
                  }}
                >
                  {drillAutoCollapse ? "On" : "Off"}
                </button>
              </div>
            </section>

            <section className="settings-section">
              <h2>Appearance</h2>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-card ${state.theme === t.id ? "active" : ""}`}
                    onClick={() => setTheme(t.id)}
                    title={t.name}
                  >
                    <div className="theme-card-preview">
                      {t.preview.map((color, i) => (
                        <div
                          key={i}
                          className="theme-card-swatch"
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                    <span className="theme-card-name">{t.name}</span>
                  </button>
                ))}
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>View animations</label>
                  <span className="setting-hint">
                    Animate elements when switching views
                  </span>
                </div>
                <div className="toggle-group">
                  {(["off", "subtle", "smooth", "expressive"] as const).map((level) => (
                    <button
                      key={level}
                      className={`toggle-btn ${viewTransitions === level ? "active" : ""}`}
                      onClick={() => {
                        setViewTransitions(level);
                        storeSave("viewTransitions", level);
                      }}
                    >
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {(
                <div className="setting-row">
                  <div className="setting-label">
                    <label>Animation style</label>
                    <span className="setting-hint">
                      Effect used when switching views
                    </span>
                  </div>
                  <div className="toggle-group">
                    {(["fade", "scale", "blur", "slide", "reveal"] as const).map((style) => (
                      <button
                        key={style}
                        className={`toggle-btn ${animationStyle === style ? "active" : ""}`}
                        disabled={viewTransitions === "off"}
                        onClick={() => {
                          setAnimationStyle(style);
                          storeSave("animationStyle", style);
                        }}
                      >
                        {style.charAt(0).toUpperCase() + style.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="hotkeys-section">
              <h2>Devices</h2>
              <div className="midi-device-section">
                <label className="midi-label devices-subsection-label">Audio Output</label>
                <div className="midi-device-row">
                  <AudioOutputDropdown
                    devices={audioOutputDevices}
                    value={selectedOutputDevice}
                    onChange={(val) => {
                      setSelectedOutputDevice(val);
                      setAudioOutputDevice(val || null);
                    }}
                  />
                  <button
                    className="midi-refresh-btn"
                    onClick={async () => {
                      const devices = await listAudioOutputDevices();
                      setAudioOutputDevices(devices);
                    }}
                    title="Refresh audio devices"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </button>
                </div>
                {selectedOutputDevice && audioOutputDevices.find(d => d.name === selectedOutputDevice)?.isBluetooth && (
                  <div className="audio-output-bt-warning">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>Bluetooth audio adds significant latency. Visual cues and sound may not sync perfectly.</span>
                  </div>
                )}
              </div>

              <div className="midi-device-section" style={{ marginTop: 28 }}>
                <label className="midi-label devices-subsection-label">Audio Input</label>
                <div className="midi-device-row">
                  <AudioInputDropdown
                    devices={evaluation.devices}
                    value={evaluation.selectedDevice ?? ""}
                    onChange={(val) => evaluation.selectDevice(val)}
                  />
                  <button
                    className="input-test-btn"
                    onClick={() => setInputTestOpen(true)}
                    title="Test audio input"
                  >
                    Test
                  </button>
                </div>
              </div>

              <div className="midi-device-section" style={{ marginTop: 28 }}>
                <label className="midi-label devices-subsection-label">MIDI</label>
                <div className="midi-device-row">
                  <MidiDeviceDropdown
                    devices={midi.devices}
                    value={midi.connectedDevice || ""}
                    onChange={(val) => {
                      if (val) {
                        midi.connect(val);
                      } else {
                        midi.disconnect();
                      }
                    }}
                  />
                  <button
                    className="midi-refresh-btn"
                    onClick={() => midi.refreshDevices()}
                    title="Refresh MIDI devices"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </button>
                </div>
                {!midi.connectedDevice && midi.devices.length === 0 && (
                  <div className="midi-status">
                    <span className="midi-status-dot" />
                    No MIDI devices detected
                  </div>
                )}
              </div>
            </section>

            <section className="settings-section">
              <h2>Practice Coach</h2>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Brain</label>
                  <span className="setting-hint">Local AI model for coaching</span>
                </div>
                <div className="toggle-group">
                  <button
                    className={`toggle-btn ${coachBrainTier === "off" ? "active" : ""}`}
                    data-tooltip="No AI coaching — timing feedback only"
                    onClick={() => { setCoachBrainTier("off"); storeSave("coachBrainTier", "off"); }}
                  >
                    Off
                  </button>
                  <button
                    className={`toggle-btn ${coachBrainTier === "standard" ? "active" : ""}`}
                    data-tooltip="Fast & lightweight model. ~1.1 GB download, ~2 GB RAM while running. Good for real-time tips."
                    disabled={modelDownloading}
                    onClick={() => {
                      if (modelStatus?.brainReady && modelStatus.brainTier === "standard") {
                        setCoachBrainTier("standard");
                        storeSave("coachBrainTier", "standard");
                      } else {
                        setPendingDownloadTier("standard");
                      }
                    }}
                  >
                    Standard
                  </button>
                  <button
                    className={`toggle-btn ${coachBrainTier === "full" ? "active" : ""}`}
                    data-tooltip="Larger model with deeper analysis. ~2.1 GB download, ~4 GB RAM. Richer feedback and practice plans."
                    disabled={modelDownloading}
                    onClick={() => {
                      if (modelStatus?.brainReady && modelStatus.brainTier === "full") {
                        setCoachBrainTier("full");
                        storeSave("coachBrainTier", "full");
                      } else {
                        setPendingDownloadTier("full");
                      }
                    }}
                  >
                    Full
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Voice</label>
                  <span className="setting-hint">Audio feedback delivery</span>
                </div>
                <div className="toggle-group">
                  {(["silent", "chime", "voice"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`toggle-btn ${coachVoiceMode === mode ? "active" : ""}`}
                      data-tooltip={
                        mode === "silent" ? "No audio — feedback appears as text only" :
                        mode === "chime" ? "Short chime sound when coach has feedback for you" :
                        "Spoken feedback using local text-to-speech after each session segment"
                      }
                      disabled={coachBrainTier === "off" || (mode !== "silent" && !modelStatus?.voiceReady)}
                      onClick={() => { setCoachVoiceMode(mode); storeSave("coachVoiceMode", mode); }}
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Notifications</label>
                  <span className="setting-hint">When to show feedback</span>
                </div>
                <div className="toggle-group">
                  {(["all", "important", "silent"] as const).map((level) => (
                    <button
                      key={level}
                      className={`toggle-btn ${coachNotifLevel === level ? "active" : ""}`}
                      data-tooltip={
                        level === "all" ? "Show all feedback — tips, praise, and corrections after every segment" :
                        level === "important" ? "Only show feedback when something needs attention — missed beats, tempo drift, etc." :
                        "No notifications — feedback is still recorded, view it in session history"
                      }
                      disabled={coachBrainTier === "off"}
                      onClick={() => { setCoachNotifLevel(level); storeSave("coachNotifLevel", level); }}
                    >
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {modelStatus?.brainReady && (
                <div className="coach-download-section">
                  <p className="setting-hint" style={{ marginBottom: 8 }}>
                    {modelStatus.brainTier === "full" ? "Full" : "Standard"} coach installed ({formatBytes(modelStatus.brainSizeBytes + modelStatus.voiceSizeBytes)})
                  </p>
                  <button
                    className="coach-download-btn"
                    onClick={async () => {
                      await deleteModels();
                      setModelStatus(await getModelStatus());
                      setCoachBrainTier("off");
                      storeSave("coachBrainTier", "off");
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                    Remove models
                  </button>
                </div>
              )}
            </section>

            <section className="settings-section">
              <h2>Widget</h2>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Mode</label>
                  <span className="setting-hint">Widget layout on screen</span>
                </div>
                <div className="toggle-group">
                  {(["compact", "comfortable"] as WidgetMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={`toggle-btn ${state.mode === mode ? "active" : ""}`}
                      onClick={() => setWidgetMode(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <label>Always on top</label>
                  <span className="setting-hint">
                    Keep widget visible over other apps
                  </span>
                </div>
                <button
                  className={`toggle-btn ${state.widgetAlwaysOnTop ? "active" : ""}`}
                  onClick={() => setWidgetAlwaysOnTop(!state.widgetAlwaysOnTop)}
                >
                  {state.widgetAlwaysOnTop ? "On" : "Off"}
                </button>
              </div>
            </section>

            <section className="hotkeys-section">
              <div className="hotkeys-section-header">
                <h2>Hotkeys</h2>
                <button
                  className={`input-test-btn ${inputTestMode ? "active" : ""}`}
                  onClick={() => setInputTestMode((v) => !v)}
                  title="Test all input bindings (keyboard, MIDI, gamepad)"
                >
                  {inputTestMode ? "Stop test" : "Test inputs"}
                </button>
              </div>
              {HOTKEY_GROUPS.map((group) => {
                const items = HOTKEYS.filter((hk) => hk.group === group.key);
                if (items.length === 0) return null;
                return (
                  <div key={group.key} className="hotkey-group">
                    <div className="hotkey-group-label">{group.label}</div>
                    <div className="hotkey-table">
                      <div className="hotkey-table-header">
                        <span>Action</span>
                        <span data-tooltip="Works only when the app is focused">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h12" />
                          </svg>
                          Key
                        </span>
                        <span data-tooltip="Works even when the app is in the background">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                          </svg>
                          Global
                          <span className="hotkey-soon-badge">soon</span>
                        </span>
                        <span data-tooltip="Bind a MIDI controller or USB foot pedal">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 18V5l12-2v13" />
                            <circle cx="6" cy="18" r="3" />
                            <circle cx="18" cy="16" r="3" />
                          </svg>
                          MIDI
                        </span>
                      </div>
                      {items.map((hk) => (
                        <div key={hk.id} className="hotkey-row">
                          <span
                            className="hotkey-action"
                            data-tooltip={hk.desc}
                          >
                            {hk.action}
                          </span>
                          <button
                            className={`hotkey-bind-btn ${bindingFor?.id === hk.id && bindingFor.type === "key" ? "listening" : ""}`}
                            onClick={() => {
                              setBindingFor({ id: hk.id, type: "key" });
                              setPendingKeys("");
                            }}
                          >
                            {platformKey(keyBindings[hk.id] || "—")}
                          </button>
                          <button className="hotkey-bind-btn" disabled>
                            {hk.globalAllowed
                              ? platformKey(globalBindings[hk.id] || "—")
                              : "—"}
                          </button>
                          <button
                            className={`hotkey-bind-btn ${midi.learnMode === hk.id ? "listening" : ""}`}
                            onClick={() => {
                              if (midi.learnMode === hk.id) {
                                midi.cancelLearn();
                              } else {
                                midi.startLearn(hk.id);
                              }
                            }}
                            title={
                              midi.learnMode === hk.id
                                ? "Listening… press a MIDI button or foot pedal"
                                : (() => {
                                    const midiBinding = midi.bindings.find((b) => b.action === hk.id);
                                    if (midiBinding) {
                                      const prefix = midiBinding.msgType === "cc" ? "CC" : midiBinding.msgType === "note" ? "Note" : "PC";
                                      return `Bound to ${prefix}#${midiBinding.number}. Click to re-learn.`;
                                    }
                                    return "Click to learn MIDI / pedal binding";
                                  })()
                            }
                          >
                            {(() => {
                              const midiBinding = midi.bindings.find((b) => b.action === hk.id);
                              const gamepadBound = footBindings[hk.id];
                              if (midi.learnMode === hk.id) return "…";
                              if (midiBinding) {
                                const prefix = midiBinding.msgType === "cc" ? "CC" : midiBinding.msgType === "note" ? "N" : "PC";
                                return `${prefix}#${midiBinding.number}`;
                              }
                              if (gamepadBound) {
                                return isGamepadBinding(gamepadBound)
                                  ? formatGamepadButton(gamepadBound)
                                  : platformKey(gamepadBound);
                              }
                              return "—";
                            })()}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="hotkey-defaults-row">
                <button
                  className="hotkey-defaults-btn"
                  onClick={() => setShowResetConfirm(true)}
                >
                  Reset to defaults
                </button>
              </div>
            </section>

            <section className="settings-section about-section support-card">
              <h2>Support</h2>
              <p className="about-text">
                Yames is free and open source. If it helps your practice,
                consider supporting development!
              </p>
              <div className="about-links">
                <button
                  className="about-link-btn support-btn"
                  onClick={() => openUrl("https://buymeacoffee.com/turutupa")}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  Buy me a coffee
                </button>
                <button
                  className="about-link-btn"
                  onClick={() => openUrl("https://github.com/turutupa/yames")}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  GitHub
                </button>
                <button
                  className="about-link-btn"
                  onClick={() => openUrl("https://turutupa.github.io/yames/")}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Website
                </button>
              </div>
              <p className="about-text" style={{ marginTop: 16 }}>
                Know a musician who'd love this? Share it!
              </p>
              <div className="about-links share-row">
                {SHARE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className={`about-link-btn share-btn${opt.id === "copy" && shareTooltip ? " copied" : ""}`}
                    onClick={() => handleShareOption(opt)}
                  >
                    {opt.id === "whatsapp" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                    )}
                    {opt.id === "x" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    )}
                    {opt.id === "facebook" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                    )}
                    {opt.id === "reddit" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
                      </svg>
                    )}
                    {opt.id === "copy" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect
                          x="9"
                          y="9"
                          width="13"
                          height="13"
                          rx="2"
                          ry="2"
                        />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                    {opt.id === "copy" && shareTooltip ? "Copied!" : opt.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section about-section">
              <h2>About</h2>
              <div className="about-info">
                <div className="about-row">
                  <span className="about-label">Version</span>
                  <span className="about-value">{appVersion}</span>
                </div>
                <div className="about-row">
                  <span className="about-label">Updates</span>
                  <span className="about-value">
                    {updateStatus === "checking" && (
                      <span className="update-status">Checking…</span>
                    )}
                    {updateStatus === "available" && (
                      <button
                        className="update-available-btn"
                        onClick={() => {
                          setUpdateStatus("downloading");
                          downloadAndInstallUpdate().catch(() => {
                            setUpdateStatus("available");
                          });
                        }}
                      >
                        v{latestVersion} available — Install
                      </button>
                    )}
                    {updateStatus === "downloading" && (
                      <span className="update-status">Updating…</span>
                    )}
                    {updateStatus === "up-to-date" && (
                      <span className="update-status up-to-date">
                        Up to date ✓
                      </span>
                    )}
                    {updateStatus === "idle" && (
                      <button
                        className="update-check-btn"
                        onClick={doUpdateCheck}
                      >
                        Check for updates
                      </button>
                    )}
                  </span>
                </div>
                <div className="about-row">
                  <span className="about-label">Platform</span>
                  <span className="about-value">{navigator.platform}</span>
                </div>
                <div className="about-row">
                  <span className="about-label">User Agent</span>
                  <span className="about-value about-value-small">
                    {navigator.userAgent}
                  </span>
                </div>
              </div>
              <div className="about-footer-divider"></div>
              <p className="about-footer">
                Made with <span className="about-heart">♥</span> for musicians
                everywhere
              </p>
            </section>
          </>
        )}
        </ViewTransition>
        {view === "settings" && (
          <SettingsTimeline
            sections={[
              { id: "general", label: "General" },
              { id: "appearance", label: "Appearance" },
              { id: "devices", label: "Devices" },
              { id: "smart-coach", label: "Practice Coach" },
              { id: "widget", label: "Widget" },
              { id: "hotkeys", label: "Hotkeys" },
              { id: "support", label: "Support" },
              { id: "about", label: "About" },
            ]}
            containerRef={contentRef}
          />
        )}
        {/* Floating play button for Metronome and Drill */}
        {(view === "beat" || view === "drill") && (
          <button
            className={`floating-play-btn ${state.isPlaying || state.speedRamp?.active ? "playing" : ""} ${isPulsing ? "pulse" : ""}`}
            onClick={() => {
              if (view === "drill") {
                if (state.speedRamp?.active) stopSpeedRamp();
                else startSpeedRamp();
              } else {
                togglePlayback();
              }
            }}
          >
            {(view === "drill" ? state.speedRamp?.active : state.isPlaying) ? (
              <>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="2" y="2" width="12" height="12" rx="1.5" />
                </svg>{" "}
                Stop
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2.5a.5.5 0 0 1 .77-.42l9 5.5a.5.5 0 0 1 0 .84l-9 5.5A.5.5 0 0 1 4 13.5z" />
                </svg>{" "}
                Play
              </>
            )}
          </button>
        )}
      </div>
      {(view === "beat" || view === "drill") && (
      <CoachCard
        open={coachOpen}
        active={coachActive}
        messages={coachMessages}
        onToggle={() => setCoachOpen((v) => !v)}
        onStartSession={() => {
          setCoachActive(true);
          setCoachOpen(true);
          setCoachMessages([{ id: crypto.randomUUID(), type: "session-start", content: "Session started", timestamp: Date.now() }]);
        }}
        onEndSession={() => {
          setCoachActive(false);
          const endMsg: FeedMessage = { id: crypto.randomUUID(), type: "session-end", content: "Session ended", timestamp: Date.now() };
          setCoachMessages((msgs) => [...msgs, endMsg]);
        }}
      />
      )}
      </div>{/* main-body */}
      {showResetConfirm && (
        <div
          className="keybinding-overlay"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="keybinding-capture"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="keybinding-capture-title">
              Reset all keybindings?
            </span>
            <div className="keybinding-capture-display">
              <span className="keybinding-capture-waiting">
                This will restore all keyboard bindings to their defaults.
              </span>
            </div>
            <div className="keybinding-capture-actions">
              <button
                className="keybinding-btn-reset"
                onClick={resetAllBindings}
              >
                Reset
              </button>
              <button
                className="keybinding-btn-remove"
                onClick={() => setShowResetConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MIDI binding conflict confirmation dialog */}
      {midi.pendingConflict && (
        <div className="keybinding-overlay" onClick={() => midi.rejectConflict()}>
          <div className="keybinding-capture" onClick={(e) => e.stopPropagation()}>
            <span className="keybinding-capture-title">MIDI Conflict</span>
            <div className="conflict-body">
              <div className="conflict-signal">
                <span className="conflict-signal-badge">
                  {midi.pendingConflict.activity.type.toUpperCase()} #{midi.pendingConflict.activity.number}
                </span>
                <span className="conflict-signal-detail">
                  Ch{midi.pendingConflict.activity.channel}
                </span>
              </div>
              <p className="conflict-message">
                is already bound to{" "}
                <strong>
                  {HOTKEYS.find((h) => h.id === midi.pendingConflict!.existingBinding.action)?.action
                    ?? midi.pendingConflict.existingBinding.action}
                </strong>.
                <br />
                Overwrite and assign to{" "}
                <strong>
                  {HOTKEYS.find((h) => h.id === midi.pendingConflict!.targetAction)?.action
                    ?? midi.pendingConflict.targetAction}
                </strong>?
              </p>
            </div>
            <div className="keybinding-capture-actions">
              <button className="keybinding-btn-reset" onClick={() => midi.rejectConflict()}>
                Cancel
              </button>
              <button
                className="conflict-accept-btn"
                onClick={() => midi.acceptConflict()}
              >
                Overwrite
              </button>
            </div>
            <label className="conflict-dont-ask">
              <input
                type="checkbox"
                checked={midiAutoAccept}
                onChange={(e) => setMidiAutoAccept(e.target.checked)}
              />
              Don't ask again
            </label>
          </div>
        </div>
      )}

      {bindingFor && (
        <div
          className="keybinding-overlay"
          onClick={() => {
            setBindingFor(null);
            setPendingKeys("");
            setPendingKeyConflict(null);
          }}
        >
          <div
            className="keybinding-capture"
            onClick={(e) => e.stopPropagation()}
          >
            {pendingKeyConflict ? (
              <>
                <span className="keybinding-capture-title">Hotkey Conflict</span>
                <div className="conflict-body">
                  <div className="conflict-signal">
                    <span className="conflict-signal-badge">{pendingKeyConflict.combo}</span>
                  </div>
                  <p className="conflict-message">
                    is already bound to{" "}
                    <strong>{pendingKeyConflict.conflictActionLabel}</strong>.
                    <br />
                    Overwrite and assign to{" "}
                    <strong>{pendingKeyConflict.targetActionLabel}</strong>?
                  </p>
                </div>
                <div className="keybinding-capture-actions">
                  <button className="keybinding-btn-reset" onClick={rejectKeyConflict}>
                    Cancel
                  </button>
                  <button className="conflict-accept-btn" onClick={acceptKeyConflict}>
                    Overwrite
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="keybinding-capture-title">
                  {HOTKEYS.find((hk) => hk.id === bindingFor.id)?.action} —{" "}
                  {bindingFor.type === "key"
                    ? "Keyboard"
                    : "Global"}
                </span>
                <div className="keybinding-capture-display">
                  {pendingKeys ? (
                    <span className="keybinding-capture-keys">{pendingKeys}</span>
                  ) : (
                    <span className="keybinding-capture-waiting">
                      Press desired key combination…
                    </span>
                  )}
                </div>
                <div className="keybinding-capture-actions">
                  <button
                    className="keybinding-btn-reset"
                    onClick={handleResetBinding}
                  >
                    Reset to default
                  </button>
                  <button
                    className="keybinding-btn-remove"
                    onClick={handleRemoveBinding}
                  >
                    Remove
                  </button>
                </div>
                <span className="keybinding-capture-hint">
                  Press Escape to cancel
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Unified input tester modal */}
      {inputTestMode && (
        <div className="keybinding-overlay" onClick={() => setInputTestMode(false)}>
          <div className="input-tester-modal" onClick={(e) => e.stopPropagation()}>
            <span className="keybinding-capture-title">Input Tester</span>
            <div className="input-tester-hint">
              Press keys, MIDI buttons, or gamepad buttons to see what they map to.
            </div>
            <div className="input-tester-log-wrapper">
              <div
                className="input-tester-log"
                ref={inputTestLogRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const thumb = el.parentElement?.querySelector(".input-tester-scrollbar-thumb") as HTMLElement | null;
                  const track = el.parentElement?.querySelector(".input-tester-scrollbar") as HTMLElement | null;
                  if (!thumb || !track) return;
                  const scrollRatio = el.scrollTop / (el.scrollHeight - el.clientHeight);
                  const trackH = track.clientHeight;
                  const thumbH = Math.max(24, (el.clientHeight / el.scrollHeight) * trackH);
                  thumb.style.height = `${thumbH}px`;
                  thumb.style.top = `${scrollRatio * (trackH - thumbH)}px`;
                  track.classList.toggle("visible", el.scrollHeight > el.clientHeight);
                }}
              >
              {inputTestLog.length === 0 ? (
                <div className="midi-tester-empty">Waiting for input…</div>
              ) : (
                inputTestLog.map((entry, i) => (
                  <div className={`input-tester-row ${i === inputTestLog.length - 1 ? "latest" : ""}`} key={i}>
                    <span className={`input-tester-source input-tester-source--${entry.source}`}>
                      {entry.source === "keyboard" ? "KEY" : entry.source === "midi" ? "MIDI" : "PAD"}
                    </span>
                    <span className="input-tester-keys">
                      {entry.source === "keyboard" ? (
                        splitCombo(entry.label).map((k, j) => (
                          <kbd key={j} className="input-tester-kbd">{k}</kbd>
                        ))
                      ) : entry.source === "midi" ? (
                        <>
                          <span className="input-tester-pill midi">{entry.label}</span>
                          {entry.detail && entry.detail.split(/\s+/).map((d, j) => (
                            <span key={j} className="input-tester-pill midi-subtle">{d}</span>
                          ))}
                        </>
                      ) : (
                        <span className="input-tester-pill gamepad">{entry.label}</span>
                      )}
                    </span>
                    <span className="input-tester-action">
                      {entry.action ? (
                        <span className="midi-tester-mapped">{entry.action}</span>
                      ) : (
                        <span className="midi-tester-unmapped">—</span>
                      )}
                    </span>
                  </div>
                ))
              )}
              </div>
              <div className="input-tester-scrollbar">
                <div className="input-tester-scrollbar-thumb" />
              </div>
            </div>
            <div className="keybinding-capture-actions">
              <button className="keybinding-btn-reset" onClick={() => setInputTestLog([])}>
                Clear
              </button>
              <button className="keybinding-btn-remove" onClick={() => setInputTestMode(false)}>
                Close
              </button>
            </div>
            <span className="keybinding-capture-hint">
              Press Escape to close
            </span>
          </div>
        </div>
      )}

      {/* Download confirmation dialog */}
      {pendingDownloadTier && (
        <div className="download-confirm-overlay" onClick={() => setPendingDownloadTier(null)}>
          <div className="download-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="download-confirm-title">Download AI Model</h3>
            <div className="download-confirm-models">
              <div className={`download-confirm-model${pendingDownloadTier === "standard" ? " download-confirm-model-selected" : ""}`}>
                <div className="download-confirm-model-name">Standard</div>
                <div className="download-confirm-model-name" style={{ fontWeight: 400, fontSize: 13 }}>Qwen 2.5 1.5B</div>
                <div className="download-confirm-model-size">~1.1 GB download &middot; ~2 GB RAM</div>
                <p className="download-confirm-model-detail">Good comments, solid Q&A, reliable timing decisions. Best for simple time signatures and moderate tempos.</p>
                <button className="download-confirm-go" onClick={() => startModelDownload("standard")}>
                  Download Standard
                </button>
              </div>
              <div className={`download-confirm-model${pendingDownloadTier === "full" ? " download-confirm-model-selected" : ""}`}>
                <div className="download-confirm-model-name">Full</div>
                <div className="download-confirm-model-name" style={{ fontWeight: 400, fontSize: 13 }}>Phi 3.5 Mini</div>
                <div className="download-confirm-model-size">~2.4 GB download &middot; ~4 GB RAM</div>
                <p className="download-confirm-model-detail">Best quality, most nuanced feedback, strongest Q&A. Handles complex patterns, fast tempos, and polyrhythms.</p>
                <button className="download-confirm-go" onClick={() => startModelDownload("full")}>
                  Download Full
                </button>
              </div>
            </div>
            <button className="download-confirm-cancel" onClick={() => setPendingDownloadTier(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Global download progress bar */}
      {modelDownloading && (() => {
        const pct = downloadProgress ? Math.round(downloadProgress.fraction * 100) : 0;
        const tierLabel = downloadingTier === "full" ? "Full" : "Standard";
        const modelName = downloadProgress?.component ?? "model";
        const label = `${tierLabel} — ${modelName} · ${downloadProgress ? formatBytes(downloadProgress.downloadedBytes) : "0 B"}${downloadProgress && downloadProgress.totalBytes > 0 ? ` / ${formatBytes(downloadProgress.totalBytes)}` : ""} (${pct}%)`;
        return (
          <div className="global-download-bar">
            <div className="global-download-bar-fill" style={{ width: `${pct}%` }} />
            <span className="global-download-bar-label global-download-bar-label-base">{label}</span>
            <span className="global-download-bar-label global-download-bar-label-filled" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>{label}</span>
            <button className="global-download-bar-cancel" onClick={() => downloadAbort.current?.abort()} title="Cancel download">
              Cancel
            </button>
          </div>
        );
      })()}

      {/* Download error bar */}
      {downloadError && (
        <div className="global-download-bar global-download-bar-error">
          <span className="global-download-bar-label">
            Download failed: {downloadError}
          </span>
          <button className="global-download-bar-close" onClick={() => setDownloadError(null)} title="Dismiss">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Download success bar */}
      {downloadSuccess && !modelDownloading && (
        <div className="global-download-bar global-download-bar-success">
          <span className="global-download-bar-label">
            Practice Coach available!
          </span>
          <button className="global-download-bar-close" onClick={() => setDownloadSuccess(false)} title="Dismiss">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
    <AudioInputTestModal
      open={inputTestOpen}
      onClose={() => setInputTestOpen(false)}
      selectedDevice={evaluation.selectedDevice}
      onDeviceChange={(d) => evaluation.selectDevice(d)}
      initialDevices={evaluation.devices}
      evaluationActive={evaluation.enabled}
    />
    </>
  );
}
