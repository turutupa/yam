export type Subdivision = 1 | 2 | 3 | 4 | 5 | 6;
export type WidgetMode = "compact" | "comfortable";
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type SpeedRamp = {
  startBpm: number;
  targetBpm: number;
  increment: number;
  decrement: number;
  barsPerStep: number;
  beatsPerBar: number;
  mode: "linear" | "zigzag";
  cyclic: boolean;
  active: boolean;
  currentStep: number;
  currentBpm: number;
  direction: "up" | "down";
  barsInStep: number;
  completed: boolean;
  warmupBeats: number;
  warmupCount: number;
};

export type AppState = {
  bpm: number;
  isPlaying: boolean;
  subdivision: Subdivision;
  mode: WidgetMode;
  corner: Corner;
  alwaysOnTop: boolean;
  widgetAlwaysOnTop: boolean;
  accentColor: string;
  theme: string;
  volume: number;
  soundType: string;
  timeSignature: number;
  speedRamp: SpeedRamp;
};

export type BeatEvent = {
  beat: number;
  subdivision: number;
  isDownbeat: boolean;
};

// ---------------------------------------------------------------------------
// MIDI types
// ---------------------------------------------------------------------------

export type MidiMsgType = "cc" | "note" | "pc";

export type MidiDeviceInfo = {
  id: number;
  name: string;
  isConnected: boolean;
};

export type MidiActivity = {
  channel: number;
  type: MidiMsgType;
  number: number;
  value: number;
};

export type MidiBinding = {
  action: string;
  channel: number | null;
  msgType: MidiMsgType;
  number: number;
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type Preset = {
  id: string;
  name: string;
  createdAt: number;
  bpm: number;
  subdivision: number;
  timeSignature: number;
  soundType: string;
  volume: number;
  view: "beat" | "drill";
  speedRamp?: {
    startBpm: number;
    targetBpm: number;
    increment: number;
    decrement: number;
    barsPerStep: number;
    beatsPerBar: number;
    mode: string;
    cyclic: boolean;
    warmupBeats: number;
  };
};

// ---------------------------------------------------------------------------
// Audio Input / Evaluation types
// ---------------------------------------------------------------------------

export type AudioInputDevice = {
  name: string;
  isDefault: boolean;
  isInterface: boolean;
};

export type AudioSpectrum = {
  bands: number[];
  rms: number;
};

export type BeatFeedback = {
  beatIndex: number;
  /** Deviation from expected beat time in ms (negative = early, positive = late) */
  deviationMs: number;
  /** Error in interval between this onset and previous (ms) */
  intervalErrorMs: number;
  /** "perfect" | "good" | "ok" | "miss" */
  classification: "perfect" | "good" | "ok" | "miss";
  /** Amplitude of matched onset (0.0 for miss) */
  amplitude: number;
  /** Current calibration offset in ms */
  calibrationOffsetMs: number;
  /** Confidence in calibration (0.0–1.0) */
  calibrationConfidence: number;
};

export type SessionReport = {
  totalBeats: number;
  hitsCount: number;
  missCount: number;
  perfectCount: number;
  goodCount: number;
  okCount: number;
  meanDeviationMs: number;
  stdDeviationMs: number;
  meanAbsDeviationMs: number;
  meanIntervalErrorMs: number;
  grade: string;
  score: number;
  deviations: number[];
  dynamicsStd: number;
  meanAmplitude: number;
  tempoStabilityMs: number;
  longestStreak: number;
};
