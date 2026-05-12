# Yames Playing Evaluation — Implementation Plan

> **Privacy-first, real-time, on-device playing analysis for musicians practicing with a metronome.**
> No AI models. No network calls. No data ever leaves the user's machine.

---

## Implementation Progress

> **Track what's done and what's pending here.** Update this section as phases are completed.
> When resuming across sessions, read this section first to know where to pick up.

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Audio Capture | Done | `audio_input.rs`, ring buffer, spectrum analyzer |
| Phase 2 — Onset Detection | Done | `onset.rs`, spectral flux, Goertzel algorithm |
| Phase 3 — Auto-Calibration & Timing | Done | `timing.rs`, `clock.rs`, running median calibration |
| Phase 4 — Real-Time UI Feedback | Done | Beat dot coloring, DriftMeter, FAB toggle |
| Phase 5 — Session Report Panel | Done | `session.rs`, EvaluationPanel with grade/stats/histogram |
| Phase 6 — MIDI Onset Input | Done | MIDI NoteOn forwarding via onset callback |
| Phase 7 — Quality Metrics | Done | Dynamics, tempo stability, longest streak |
| Phase 8 — Advanced Insights | Deferred | History UI deferred per user request |

**Additional completed work:**
- Settings page: Evaluation section with device picker, test button, privacy note
- Pocket Check rename (formerly "Tap It") with instrument input support
- Spectrum analyzer DC offset fix (skip bin 0)
- FAB toggle moved from header to bottom-right corner
- Spectrum analyzer shows to the left of FAB

**Remaining (deferred):**
- Session history persistence / review UI

---

## Vision

Yames becomes the **first metronome that actually listens to you and tells you how you're doing** — without sending your audio to a server, without requiring a GPU, without a 500MB AI model bundled in. Just clean, deterministic signal processing running in real-time.

**Tagline:** *"Your playing, analyzed locally. Your audio never leaves your machine."*

---

## Key Design Decisions

These were discussed and locked in. Do not revisit without user input.

1. **Not a separate tab.** Evaluation augments Metronome, Drill, and Pocket Check (formerly Tap It) views. The engine listens whenever enabled, regardless of which tab you're on.
2. **On/off toggle** controls whether audio capture is active at all. Visually distinct from the real-time feedback toggle.
3. **No calibration wizard.** The system auto-detects latency from the first few bars and refines continuously. Users never manually calibrate.
4. **Spectrum analyzer** (bar graph) in bottom-right corner. Only visible when evaluation is on AND audio signal is detected. Reacts to playing in real-time.
5. **Right side panel** for session report. Slides in when a session ends.
6. **MIDI note-on as alternative onset source.** Zero-latency path for electronic drums and keyboards. Reuses existing MIDI infrastructure.
7. **Device picker with smart defaults.** Auto-detect audio interfaces (Focusrite, Apollo, etc.) and prefer their input. Many modern interfaces have built-in loopback (e.g., Focusrite "Send Direct Monitor mix to Loopback") — no BlackHole needed.
8. **Privacy-first.** No audio saved by default. No network calls. All DSP on-device. Clear UI indicator when mic is active.

---

## The Critical Insight: Latency Doesn't Matter, Spacing Does

**The problem:** Audio has unavoidable latency:

```
User strikes string → audio interface → DAW/amp sim → output → user hears it
                                                              → mic/loopback → us
Total: anywhere from 5ms to 100ms+
```

If we naively compare onset timestamps to metronome beat timestamps, a user who is **perfectly on tempo** will appear to be **systematically late**.

**The solution: measure intervals, not absolute positions.**

What defines "playing in tempo" is the **spacing between consecutive notes**. A guitarist playing quarter notes at 120 BPM should produce notes 500ms apart. If they're 500ms apart, they're nailing the tempo — even if every note is 30ms after the click.

### Three layers of analysis

1. **Interval analysis (primary metric):** Measure deltas between consecutive onsets, compare to expected note duration. Latency-independent. This is THE core metric.
2. **Auto-calibration (continuous):** Running median of offsets between onsets and nearest beats. Converges within 8-16 beats. Adapts automatically when device/latency changes. No user action needed.
3. **Phase-locked alignment (advanced):** Find the best constant offset that minimizes total error. The offset IS the latency; the residual error IS the actual timing inaccuracy.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ AUDIO INPUT (Rust, cpal input stream, ~5ms latency)              │
│  cpal::Stream callback → lock-free ring buffer (4 sec)           │
│  Compute RMS every 50ms → emit "audio-level" event for spectrum  │
│  Compute 16-band spectrum every 50ms → emit "audio-spectrum"     │
└──────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────┐
│ MIDI INPUT (existing midir, optional alternative)                │
│  note-on events → convert to Onset { ts_ns, velocity, ... }     │
│  Skip all DSP — MIDI gives us onsets directly                    │
└──────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────┐
│ DSP THREAD (analyzer, dedicated thread, never blocks audio)      │
│                                                                   │
│  1. ONSET DETECTION (audio path only, MIDI skips this)           │
│     Spectral flux + adaptive threshold + peak picking            │
│     → stream of Onset { ts_ns, amp, centroid, sharpness }        │
│                                                                   │
│  2. AUTO-CALIBRATION                                             │
│     Running median of (onset_ts - nearest_beat_ts) over last 16  │
│     Converges in ~8 beats, adapts continuously                   │
│     No user intervention ever needed                             │
│                                                                   │
│  3. METRONOME-AWARE ALIGNMENT                                    │
│     For each onset, find nearest expected beat                   │
│     Apply auto-calibration offset                                │
│     Compute deviation_ms relative to grid                        │
│                                                                   │
│  4. INTERVAL ANALYSIS                                            │
│     Compute Δt between consecutive onsets                        │
│     Compare to expected interval (60_000 / bpm / subdivision)    │
│     Compute interval_error_ms — latency-independent              │
│                                                                   │
│  5. PER-BEAT METRICS                                             │
│     amplitude vs running average → accent_strength               │
│     spectral_flatness in pre-onset gap → cleanliness             │
│     pick attack consistency → technique_consistency              │
│                                                                   │
│  → emit "beat-feedback" event per beat                           │
│  → append BeatRecord to session log                              │
└──────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────┐
│ SESSION AGGREGATOR (on stop / drill end)                         │
│  Roll up BeatRecords into SessionReport                          │
│  Compute trends, hot spots, summaries                            │
│  Emit "session-report" event → right panel slides in             │
│  Persist via tauri-plugin-store                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Threading rules:**
- Audio thread: cpal callback only — writes to ring buffer, computes RMS + spectrum. Nothing else.
- Analyzer thread: spins on the ring buffer, runs all DSP. Allowed to fall behind (drops oldest, never blocks).
- UI thread: receives Tauri events, renders. Never touches audio data directly.

**No FFI. No C dependencies. No GPU. No model files.**

---

## File Plan

### Rust Backend (new files)

| File | Purpose |
|------|---------|
| `src-tauri/src/audio_input.rs` | cpal input stream, device enumeration, ring buffer, RMS/spectrum computation, emit `audio-level` and `audio-spectrum` events |
| `src-tauri/src/onset.rs` | Spectral flux onset detector: STFT, adaptive threshold, peak picking. Outputs `Onset` structs |
| `src-tauri/src/timing.rs` | Metronome-aware alignment, auto-calibration (running median), interval analysis, per-beat metrics. Emits `beat-feedback` events |
| `src-tauri/src/session.rs` | Session aggregator: collects BeatRecords, computes summary stats, letter grade, insights. Emits `session-report` event |

### Rust Backend (modified files)

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Register new commands, init audio_input module |
| `src-tauri/src/commands.rs` | New commands: `list_audio_input_devices`, `start_evaluation`, `stop_evaluation`, `get_evaluation_state`, `set_evaluation_device`, `set_evaluation_input_type` |
| `src-tauri/src/engine.rs` | Emit beat timestamps on `beat-tick` event (analyzer needs to know when beats fire) |
| `src-tauri/src/midi.rs` | New mode: forward note-on events as onsets to timing.rs when evaluation is active |
| `src-tauri/src/state.rs` | Add `EvaluationState` fields: enabled, device_id, input_type, show_realtime_feedback |
| `src-tauri/Cargo.toml` | Add `ringbuf`, `realfft` crates |

### Frontend (new files)

| File | Purpose |
|------|---------|
| `src/hooks/useEvaluation.ts` | Hook: subscribes to `audio-level`, `audio-spectrum`, `beat-feedback`, `session-report` events. Manages evaluation UI state |
| `src/components/SpectrumAnalyzer.tsx` | Bottom-right fixed spectrum bar graph. 16-32 bars. Theme-aware. Only visible when signal detected |
| `src/components/EvaluationPanel.tsx` | Right side panel: session report, letter grade, stats, timing histogram, insights, save/discard/re-run |
| `src/styles/evaluation.css` | Styles for spectrum analyzer, evaluation panel, beat dot coloring, toggle controls |

### Frontend (modified files)

| File | Changes |
|------|---------|
| `src/components/MainWindow.tsx` | Add evaluation on/off toggle, real-time feedback toggle, mount SpectrumAnalyzer and EvaluationPanel, color-tint beat dots based on `beat-feedback`, rename "Tap It" → "Pocket Check" |
| `src/components/DrillView.tsx` | Accept beat-feedback coloring on drill grid cells |
| `src/components/FullscreenView.tsx` | Subtle beat-feedback coloring in zen mode (optional) |
| `src/components/TrackView.tsx` | Rename to `PocketCheck.tsx`. Add instrument onset input (audio/MIDI) as alternative to keyboard taps |
| `src/styles/track-view.css` | Rename to `pocket-check.css` |
| `src/ipc.ts` | New commands and event listeners for evaluation |
| `src/types.ts` | New types: `BeatFeedback`, `SessionReport`, `EvaluationConfig`, `AudioSpectrum` |

---

## UI Design

### Evaluation Toggle (on/off)

Location: **Header bar**, near the existing controls (volume, sound type, widget toggle).

- **Off state:** Grayed-out mic/waveform icon. No audio capture. No spectrum. No feedback.
- **On state:** Theme-colored mic/waveform icon, subtle glow/pulse. Audio capture starts. Spectrum analyzer appears when signal detected.
- Click to toggle. Tooltip: "Enable playing evaluation" / "Disable playing evaluation."
- State persisted in settings.

### Real-Time Feedback Toggle

Location: **Near the evaluation toggle** (small secondary control). Only visible when evaluation is on.

- **Off:** Engine records silently, you get the report at the end only.
- **On:** Beat dots get color-tinted in real-time (green/yellow/orange/red per beat).
- Visually distinct from the on/off toggle (e.g., a small eye icon, or a toggle switch).

### Spectrum Analyzer (bottom-right)

Position: **Fixed, bottom-right corner** of the main window.

- **16 vertical bars** representing frequency bands (bass → treble).
- Height animated based on real-time FFT magnitude.
- Bars use `var(--accent)` with varying opacity.
- **Only visible when:** evaluation is on AND audio signal is above noise floor.
- **Fades in/out** smoothly when signal starts/stops.
- Small enough to not obstruct main UI (~80px wide × 40px tall).
- Click on it: could open device settings or show input level detail.

The industry term for this is a **spectrum analyzer** or **bar graph equalizer visualization**. Think: Winamp visualizer, Spotify's old EQ, or the VU bars on a mixing console. Not a waveform (oscilloscope) — bars are more recognizable and look better at small size.

### Beat Dot Coloring (real-time feedback)

When real-time feedback is on, the existing beat dots in Metronome and Drill views get a color tint after each beat:

| Classification | Color | Deviation |
|---------------|-------|-----------|
| **Tight** | Green | < 15ms |
| **Good** | Yellow-green | 15-30ms |
| **Loose** | Yellow | 30-50ms |
| **Off** | Orange-red | 50-100ms |
| **Missed** | Gray (dimmed) | No onset detected |

Colors use theme-aware CSS custom properties (not hardcoded). Each dot briefly flashes its color then fades, so the display doesn't become a Christmas tree.

Optional: subtle tick mark offset on each dot (left = early, right = late).

### Live Drift Meter

Small horizontal indicator near the beat dots (or below BPM display):
- Center = on tempo
- Left = rushing
- Right = dragging
- Based on trailing 8-beat average
- Only shown when real-time feedback is on

### Right Panel — Session Report

When the metronome stops (or a drill completes) and evaluation was on:

- **Right panel auto-opens** from the right edge (~280px wide), same pattern as the Preset Sidebar on the left.
- **Pushes content over** — NOT an overlay. The main content area shrinks to make room. Metronome/drill stays fully visible and functional.
- User can dismiss it anytime (close button, Escape). No forced interaction.
- **Content:**

```
┌─────────────────────────┐
│  Session Report         │
│                         │
│  ┌───────────────────┐  │
│  │    A-             │  │  ← Big letter grade
│  │  "Solid timing"   │  │  ← One-line summary
│  └───────────────────┘  │
│                         │
│  Timing                 │
│  ● On-time: 82%         │
│  ● Avg deviation: 18ms  │
│  ● Consistency: 91%     │
│  ● Tendency: Rushing ←  │
│                         │
│  ┌───────────────────┐  │
│  │ ▁▂▃▅█▇▅▃▂▁       │  │  ← Timing histogram
│  │ -50  0  +50  ms   │  │     (-100ms to +100ms)
│  └───────────────────┘  │
│                         │
│  Insights               │
│  • You rushed above      │
│    130 BPM               │
│  • Beat 3 was your       │
│    weakest consistently  │
│                         │
│  [Save] [Discard] [Redo]│
│                         │
│  ─────────────────────  │
│  120 BPM • 4/4 • 2m15s │
│  Drill: 80→140 (+5)     │
└─────────────────────────┘
```

- **Dismiss:** Click outside, press Escape, or click [Discard].
- **Save:** Persists to local history. Can be viewed later in Settings → History.
- **Redo:** Restarts the same drill/BPM configuration.

### Device Picker

Location: **Settings → Evaluation** (new settings section).

- Dropdown listing all cpal input devices.
- **Smart default:** If an audio interface is detected (name contains "Scarlett", "Focusrite", "Apollo", "MOTU", "Audient", etc.), select its input automatically. Otherwise fall back to default system input.
- **Input type selector:** "Audio Input" | "MIDI" — when MIDI is selected, onset detection uses note-on events instead of DSP. Device dropdown changes to MIDI device list.
- **Loopback guidance:** If macOS and no interface detected, show a subtle note: "For processed guitar tone, enable loopback on your interface or install BlackHole."
- **Test button:** "Test Input" — plays a 2-second preview of the spectrum analyzer so you can verify the device is picking up your instrument.
- **Privacy note:** "Audio is processed locally and never saved to disk."

---

## Auto-Calibration — How It Works

No wizard. No user action. The system learns the latency offset automatically.

### Algorithm

```
State:
  offset_buffer: circular buffer of last 16 offset measurements
  calibrated_offset_ms: f64 = 0.0
  calibration_confidence: f64 = 0.0  (0.0 = unknown, 1.0 = high)

On each onset:
  1. Find nearest beat timestamp (within ±200ms grace window)
  2. raw_offset = onset_ts - beat_ts  (positive = late, negative = early)
  3. Push raw_offset to offset_buffer
  4. calibrated_offset_ms = median(offset_buffer)
  5. calibration_confidence = 1.0 - (stddev(offset_buffer) / 50.0).clamp(0, 1)
     (high stddev = low confidence = noisy or inconsistent)
  6. adjusted_deviation = raw_offset - calibrated_offset_ms
     → This is the "real" timing error after removing latency

Why median, not mean:
  - Robust to outliers (missed notes, double strikes, noise)
  - Converges faster than mean in presence of non-Gaussian noise
  - If user is consistent, median ≈ mean anyway

Why 16 samples:
  - At 120 BPM, 16 beats = 8 seconds — fast enough to feel responsive
  - Large enough to filter out individual bad notes
  - Small enough to adapt if user changes device mid-session
```

### Adaptation behavior

- **First 8 beats:** Calibration is converging. Show a subtle "calibrating..." indicator on the drift meter. Don't color beat dots until confidence > 0.5.
- **After 8+ beats:** Calibration is stable. Full feedback active.
- **Device change mid-session:** Offset buffer resets. Re-converges in ~8 beats. No user action needed.
- **BPM change (drill ramp):** Calibration carries over — latency is hardware-dependent, not BPM-dependent.

---

## What We Give Feedback On

### Tier 1 — Core (Phases 1-5)

| Metric | What it measures | Why it matters |
|--------|------------------|----------------|
| **Interval consistency** | Std dev of intervals between consecutive onsets | The single best measure of "in the pocket" |
| **Tempo drift** | Trend of intervals over time (rushing/dragging) | Tells you if you speed up/slow down |
| **Hit rate** | % of expected beats with a detected onset | Are you actually playing the notes? |
| **Per-beat deviation** | Each note's offset from grid (after auto-calibration) | Per-note feedback for visualization |
| **Letter grade** | Weighted composite of above | Quick summary |

### Tier 2 — Quality (Phase 7)

| Metric | What it measures |
|--------|------------------|
| **Subdivision accuracy** | Timing precision on 8ths/16ths/triplets (not just downbeats) |
| **Accent dynamics** | Amplitude ratio: accents vs non-accents |
| **Dynamic consistency** | Std dev of amplitude on non-accented notes |
| **Attack consistency** | Std dev of spectral centroid at onset |
| **Note clarity** | Spectral flatness ratio: between notes vs at notes |
| **Dead notes** | Onsets with abnormally low amplitude or spectral spread |

### Tier 3 — Advanced (Phase 8)

| Metric | What it measures |
|--------|------------------|
| **Stamina / fatigue** | Consistency degradation over long sessions |
| **Tempo ceiling** | BPM where consistency drops below threshold |
| **Microtiming pattern** | Systematic habits (e.g., always rush 16ths, drag quarters) |
| **Double-strike detection** | Two onsets too close when one was expected |

---

## Phases

### Phase 1 — Audio Capture & Device Management

**Goal:** Reliably capture audio from any input device. Show spectrum analyzer.

**Rust work:**
- `src-tauri/src/audio_input.rs`:
  - cpal input stream wrapper
  - Device enumeration: `list_audio_input_devices()` → returns `Vec<AudioDevice { id, name, is_default, is_interface }>`
  - Interface detection: match device names against known patterns ("Scarlett", "Focusrite", "Apollo", "MOTU", "Audient", "UAD", "PreSonus", "Behringer", "SSL", "RME")
  - Lock-free SPSC ring buffer (`ringbuf` crate), 4 seconds capacity
  - RMS computation every 50ms → emit `audio-level` event
  - 16-band spectrum computation every 50ms (simple FFT + band grouping) → emit `audio-spectrum` event
  - Tauri commands: `list_audio_input_devices`, `start_audio_capture(device_id)`, `stop_audio_capture`
- `src-tauri/src/state.rs`: Add `EvaluationState { enabled: bool, device_id: Option<String>, input_type: "audio" | "midi", show_realtime: bool }`
- `src-tauri/src/commands.rs`: Register new commands
- `src-tauri/src/lib.rs`: Init audio_input module
- `src-tauri/Cargo.toml`: Add `ringbuf` dependency. Note: `cpal` is already available via `rodio`.

**Frontend work:**
- `src/hooks/useEvaluation.ts`: Subscribe to `audio-level` and `audio-spectrum` events. Manage evaluation on/off state.
- `src/components/SpectrumAnalyzer.tsx`: 16-bar fixed-position component (bottom-right). Receives spectrum data from hook. Theme-aware colors. Fades in when signal detected, fades out when silent.
- `src/styles/evaluation.css`: Spectrum analyzer styles, fade animations.
- `src/components/MainWindow.tsx`: Add evaluation on/off toggle in header. Mount SpectrumAnalyzer.
- `src/ipc.ts`: Add new commands and event listeners.
- `src/types.ts`: Add `AudioDevice`, `AudioSpectrum`, `EvaluationConfig` types.
- Settings → new "Evaluation" section: device picker, input type selector, test button, privacy note.

**Done when:** You can turn on evaluation, see the spectrum analyzer react to your guitar/mic, and pick different audio devices.

---

### Phase 2 — Onset Detection

**Goal:** Reliably detect when the user plays a note.

**Rust work:**
- `src-tauri/src/onset.rs`:
  - Spectral flux onset detector
  - 1024-sample Hann-windowed STFT, 50% overlap (512 hop)
  - Forward spectral flux: sum of positive frequency bin differences
  - Adaptive threshold: median(last 1s of flux values) × multiplier (start at 1.5, tunable)
  - Refractory period: 50ms minimum between onsets (prevents double-trigger)
  - Peak interpolation for sub-frame timestamp precision
  - Output: `Onset { ts_ns: u64, amplitude: f32, spectral_centroid: f32, sharpness: f32 }`
  - Onset detector runs on analyzer thread, consumes from ring buffer
  - Emit `onset-detected` event (for debugging/visualization, can disable in production)
- `src-tauri/Cargo.toml`: Add `realfft` dependency

**Tuning:**
- Test with: clean electric guitar, distorted guitar, acoustic guitar, bass, drums, piano, claps
- Parameters exposed to dev menu for tuning: threshold_multiplier, refractory_ms, min_amplitude
- Goal: < 5% false positive rate, < 2% miss rate on clean transients

**Done when:** Onsets are reliably detected across instrument types with < 30ms detection latency.

---

### Phase 3 — Auto-Calibration & Timing Analysis

**Goal:** Compare detected onsets to metronome beats. Auto-calibrate. Compute timing metrics.

**Rust work:**
- `src-tauri/src/engine.rs`: Emit `beat-tick` event on every metronome beat with `{ ts_ns, beat_index, is_downbeat, expected_interval_ms }`. This is the reference clock for the analyzer.
- `src-tauri/src/timing.rs`:
  - Receives onset stream (from onset.rs or MIDI) + beat-tick stream (from engine.rs)
  - For each onset, find nearest beat within ±200ms grace window
  - Auto-calibration: running median of last 16 offsets (see algorithm above)
  - Compute per-beat: `BeatFeedback { beat_index, deviation_ms, interval_error_ms, classification, amplitude, calibration_confidence }`
  - Classification: tight (<15ms), good (<30ms), loose (<50ms), off (<100ms), missed (no onset)
  - Interval analysis: Δt between consecutive onsets vs expected interval
  - Drift detection: linear regression on last 16 interval errors (positive slope = slowing down, negative = speeding up)
  - Emit `beat-feedback` event per beat
  - Append `BeatRecord` to session accumulator

**Done when:** The system correctly classifies beats as tight/good/loose/off/missed, auto-calibration converges within 8 beats, and interval analysis works independently of latency.

---

### Phase 4 — Real-Time UI Feedback + Pocket Check

**Goal:** As you play, you see how you're doing on each beat. Also rename Tap It → Pocket Check and upgrade it to support instrument input.

**Why "Pocket Check":** Musicians say "in the pocket" for tight timing. Pocket Check is the quick-round, DDR-style game mode — same onset engine under the hood, but packaged as a short scored challenge. With instrument support, it's no longer just keyboard taps — you play your actual instrument and get scored.

**Frontend work:**
- `src/hooks/useEvaluation.ts`: Subscribe to `beat-feedback` events. Maintain array of recent feedback for beat dot coloring.
- `src/components/MainWindow.tsx`:
  - Rename "Tap It" tab → "Pocket Check" throughout
  - Real-time feedback toggle (eye icon or small switch near eval toggle)
  - Color-tint beat dots based on `beat-feedback`:
    - Tight → green flash
    - Good → yellow-green flash
    - Loose → yellow flash
    - Off → orange-red flash
    - Missed → gray dim
  - Colors defined as CSS custom properties for theme awareness
  - Each dot briefly flashes then fades (200ms fade)
  - Live drift meter: small horizontal bar below BPM display. Center = on tempo, left = rushing, right = dragging. Based on trailing 8-beat average.
  - "Calibrating..." subtle text near drift meter until confidence > 0.5
- `src/components/TrackView.tsx` → rename to `PocketCheck.tsx`:
  - Keep existing keyboard/mouse tap input as default
  - When evaluation is on: accept instrument onsets (audio/MIDI) as taps instead of keyboard
  - Same scoring UI, same quick-round format, but now you play your instrument
  - Input source indicator: "Tapping" vs "Playing [device name]"
- `src/components/DrillView.tsx`: Same beat coloring on drill grid cells (current step's beats get colored)
- `src/components/FullscreenView.tsx`: Optional subtle coloring in zen mode
- `src/styles/evaluation.css`: Beat dot color animation keyframes, drift meter styles
- `src/styles/track-view.css` → rename to `pocket-check.css`

**Done when:** Beat dots flash with timing colors in real-time, drift meter shows rushing/dragging, and it all looks good across all 10 themes.

---

### Phase 5 — Session Report Panel

**Goal:** Detailed end-of-session summary with actionable insights.

**Rust work:**
- `src-tauri/src/session.rs`:
  - Accumulates `BeatRecord`s during a session
  - On session end (metronome stop or drill complete), compute:
    - Hit rate, on-time %, per-classification breakdown
    - Mean & stddev of interval errors (consistency score)
    - Rushing/dragging tendency (signed score)
    - Per-step breakdown for drill ramps (which BPM was hardest?)
    - Timing histogram: -100ms to +100ms in 5ms bins
    - Drift over time (sampled every 8 beats)
    - Letter grade: A+ / A / A- / B+ / B / B- / C+ / C / C- / D / F based on weighted composite
    - 1-3 insight strings from templates (e.g., "You rushed above 130 BPM", "Beat 3 was consistently weak")
  - Emit `session-report` event with full `SessionReport` struct
  - Persist to `tauri-plugin-store` (last 100 sessions)

**Frontend work:**
- `src/components/EvaluationPanel.tsx`: Right side panel (~280px wide)
  - Slides in from right edge on `session-report` event
  - Big letter grade with one-line summary
  - Stat rows: on-time %, avg deviation, consistency, tendency
  - Timing histogram visualization (simple bar chart)
  - Insights list (1-3 bullets)
  - Action buttons: [Save] [Discard] [Redo]
  - Session metadata footer: BPM, time signature, duration, drill config
  - Dismiss: click outside, Escape, or Discard
- `src/styles/evaluation.css`: Panel slide animation, stat layout, histogram bars, grade styling
- `src/components/MainWindow.tsx`: Mount EvaluationPanel, manage panel open/close state

**Done when:** Session report panel slides in with meaningful stats after stopping, looks good across themes, and save/discard/redo all work.

---

### Phase 6 — MIDI Onset Input

**Goal:** Electronic drummers and keyboard players get zero-latency onset detection via MIDI.

**Rust work:**
- `src-tauri/src/midi.rs`: When evaluation is active and input_type is "midi":
  - Forward note-on events as `Onset { ts_ns: now(), amplitude: velocity/127.0, ... }`
  - Send to timing.rs through the same channel as audio onsets
  - No DSP needed — MIDI gives us exact onset times
- `src-tauri/src/audio_input.rs`: When input_type is "midi", don't start cpal stream (save resources)

**Frontend work:**
- Settings → Evaluation: Input type toggle "Audio" | "MIDI"
- When MIDI selected, device dropdown shows MIDI devices (from existing `listMidiDevices()`)
- Spectrum analyzer shows MIDI activity (velocity bars per note) instead of audio spectrum

**Done when:** A MIDI keyboard or e-drum kit triggers beat feedback with zero added latency.

---

### Phase 7 — Quality Metrics (Tier 2)

**Goal:** Beyond timing — how clean and dynamic is the playing?

**Rust work (timing.rs + session.rs extensions):**
- Subdivision-aware timing (analyze ALL subdivisions, not just downbeats)
- Accent dynamics: amplitude ratio of accented vs non-accented beats
- Attack consistency: std dev of spectral centroid at onset across session
- Note clarity: spectral flatness ratio (between notes vs at notes)
- Dead note detection: onsets with abnormally low amplitude or spectral spread

**Frontend work:**
- New session report sections: "Dynamics" and "Clarity"
- Beat dot coloring optionally reflects clarity instead of timing (toggle in settings)

---

### Phase 8 — Advanced Insights (Tier 3)

**Goal:** Long-term pattern recognition.

**Deliverables:**
- Stamina analysis: consistency vs session position (first quarter vs last quarter)
- Tempo ceiling detection: auto-suggest personal "comfort zone" BPM from history
- Microtiming pattern report ("you tend to rush 16ths but drag 8ths")
- Practice suggestions based on weakest metric
- Settings → History: browse past sessions, trend charts over weeks

---

## Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| FFT library | `realfft` | Pure Rust, ~30KB, real-valued specialization |
| Ring buffer | `ringbuf` | Lock-free SPSC, perfect for audio→analyzer |
| FFT size | 1024 samples | 21ms window @ 48kHz, captures bass fundamentals |
| Hop size | 512 samples | 50% overlap, ~10ms hop = 100Hz onset resolution |
| Sample rate | Whatever cpal gives | Don't resample; algorithm is sample-rate-agnostic |
| Threading | Dedicated analyzer thread, lock-free from audio | Never block audio |
| Persistence | `tauri-plugin-store` | Already used for settings. Local JSON, no DB |
| Timing source | `std::time::Instant` | Same monotonic clock the metronome engine uses |
| Calibration | Running median, 16-sample window | Robust, fast convergence, adaptive |
| Spectrum bands | 16 bands, logarithmic spacing | Matches musical frequency distribution |

**New crate dependencies: `ringbuf`, `realfft`. Nothing else.**

---

## Performance Budget

| Component | Target | Rationale |
|-----------|--------|-----------|
| Audio capture latency | < 20ms | cpal default buffer |
| Onset detection latency | < 30ms after onset | One frame + processing |
| Visual feedback latency | < 80ms after onset | Onset + timing + IPC + render |
| Steady-state CPU | < 5% on M1, < 10% mid-laptop | Background-friendly |
| RAM overhead | < 50MB | Ring buffer + FFT scratch + session log |
| Bundle size impact | < 200KB | realfft + ringbuf + small Rust code |

---

## Audio Input — Platform Notes

### macOS
- **Audio interface (e.g., Focusrite Scarlett Solo):** cpal sees it as a regular input device. Direct instrument signal = best quality. Many modern interfaces have built-in loopback ("Send Direct Monitor mix to Loopback" in Focusrite Control) — this sends processed audio back as an input, so users running Amplitube/Guitar Rig get their processed tone without BlackHole.
- **Loopback without interface:** Requires BlackHole (free, open-source virtual audio device). User creates Multi-Output Device in Audio MIDI Setup. Show setup guide link in Settings.
- **Built-in mic:** Works but noisy. Last resort.

### Windows
- **Audio interface:** Same as macOS — cpal input device.
- **WASAPI loopback:** Built into Windows. cpal supports it natively via `--features cpal/loopback`. No extra software needed.
- **Built-in mic:** Works.

### Linux
- **PulseAudio/PipeWire monitor sources:** Appear as regular input devices. Usually works out of the box.
- **JACK:** cpal supports JACK backend. Pro audio users on Linux often use JACK.

### Smart Default Logic
```
1. Enumerate all input devices
2. If any device name matches known interface patterns → select it
3. Else if system default input exists → select it
4. Else → show "No audio input detected" with setup guidance
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Click bleed into mic triggers false onsets | Cross-correlate detected onset with known click waveform; if high correlation, suppress. Also: click plays through output, mic hears room reflection — spectral flux of a reflected click is much weaker than a real instrument transient |
| Excessive latency masks real timing | Auto-calibration handles it. Interval analysis is latency-independent |
| Background noise triggers onsets | Adaptive threshold + minimum amplitude gate + spectral feature filter |
| Audio device disappears mid-session | Detect, pause analysis, show error toast, attempt reconnect |
| Performance regression on slow machines | Auto-disable if frame budget exceeded. Show warning in settings |
| User plays notes that don't align to any beat | Grace window of ±200ms. Notes outside = ignored. Wide window = forgiving |
| Drummer plays multiple drums per beat | Cluster detection: group onsets within 20ms as one "hit" |
| BPM change during drill resets calibration | No — calibration offset is hardware latency, not BPM-dependent. Carries over across BPM changes |

---

## Privacy & Marketing

**In-app:**
- Mic indicator visible when capture is active (the evaluation toggle itself)
- "All processing local. Audio never saved or transmitted." in Settings → Evaluation
- Easy "Delete all session history" button

**External:**
- Landing page: *"The first metronome that grades your playing — without spying on you"*
- Compare vs Yousician/Melodics: *"They send your audio to servers. We don't even have servers."*

---

## Companion Document

See [`AI_EVALUATION_BACKLOG.md`](AI_EVALUATION_BACKLOG.md) for future AI-augmented features that build on top of this DSP foundation.
