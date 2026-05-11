# Yames Playing Evaluation — DSP-Only Implementation Plan

> **Privacy-first, real-time, on-device playing analysis for musicians practicing with a metronome.**
> No AI models. No network calls. No data ever leaves the user's machine.

---

## Vision

Yames becomes the **first metronome that actually listens to you and tells you how you're doing** — without sending your audio to a server, without requiring a GPU, without a 500MB AI model bundled in. Just clean, deterministic signal processing running in real-time.

**Tagline:** *"Your playing, analyzed locally. Your audio never leaves your machine."*

---

## The Critical Insight: Latency Doesn't Matter, Spacing Does

This is the most important design decision in the whole plan.

**The problem:** Audio has unavoidable latency:

```
User strikes string → audio interface → DAW/amp sim → output → user hears it
                                                              → mic/loopback → us
Total: anywhere from 5ms to 100ms+
```

If we naively compare onset timestamps to metronome beat timestamps, a user who is **perfectly on tempo** will appear to be **systematically late** — by an amount that depends on their hardware setup.

**The solution: measure intervals, not absolute positions.**

What actually defines "playing in tempo" is the **spacing between consecutive notes**. A guitarist playing quarter notes at 120 BPM should produce notes 500ms apart. If they're 500ms apart, they're nailing the tempo — even if every note is 30ms after the click. The systematic offset is just latency; the consistency is the playing.

### Three layers of analysis

1. **Calibration (one-time, optional):** Detect the user's typical latency offset and subtract it from displayed feedback so the visual feels right
2. **Interval analysis (primary metric):** Measure the deltas between consecutive onsets, compare to expected note durations. This is THE core metric. Latency-independent.
3. **Phase-locked alignment (advanced):** Use the metronome beats as a phase reference and find the best constant offset that minimizes total error. Tells us "you're playing at the right tempo, just consistently 23ms behind." That offset IS the latency, and the residual error after subtracting it IS the actual timing inaccuracy.

This is how every serious music timing tool (DrumBot, BeatScanner, academic MIR systems) handles latency. We do the same.

---

## Calibration Flow

Before first use, run a quick calibration:

1. Metronome plays 8 quarter-note beats at 80 BPM
2. User taps a single string (or claps, or hits anything that produces a clear transient) on each beat
3. We measure the average offset between metronome ticks and detected onsets
4. Save that offset as the user's "system latency" in settings (`audioInputCalibrationOffsetMs`)
5. Subtract it from all future onset timestamps before displaying feedback

**Why optional:** Interval analysis works without it. Calibration only improves the visual feedback by removing the systematic shift. Users can skip it.

**Re-calibration:** Suggested when user changes audio device, with a one-tap button "Re-calibrate."

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ AUDIO INPUT (Rust thread, ~5ms latency)                          │
│  cpal::Stream callback → lock-free ring buffer (4 sec)           │
│  Compute RMS every 50ms → emit "audio-level" event for VU meter  │
└──────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────┐
│ DSP THREAD (analyzer, dedicated thread, never blocks audio)      │
│                                                                   │
│  1. ONSET DETECTION                                              │
│     Spectral flux + adaptive threshold + peak picking            │
│     → stream of Onset { ts_ns, amp, centroid, sharpness }        │
│                                                                   │
│  2. METRONOME-AWARE ALIGNMENT                                    │
│     For each detected onset, find nearest expected beat          │
│     Apply calibration offset                                     │
│     Compute deviation_ms relative to grid                        │
│                                                                   │
│  3. INTERVAL ANALYSIS                                            │
│     Compute Δt between consecutive onsets                        │
│     Compare to expected interval (60_000 / bpm / subdivision)    │
│     Compute interval_error_ms — latency-independent              │
│                                                                   │
│  4. PER-BEAT METRICS                                             │
│     amplitude vs running average → accent_strength               │
│     spectral_flatness in pre-onset gap → cleanliness             │
│     pick attack consistency → technique_consistency              │
│                                                                   │
│  → emit "beat-feedback" event per beat                           │
│  → append BeatRecord to session log                              │
└──────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────┐
│ SESSION AGGREGATOR (on drill end or manual stop)                 │
│  Roll up BeatRecords into SessionReport                          │
│  Compute trends, hot spots, summaries                            │
│  Emit "session-report" event → frontend modal                    │
│  Persist via tauri-plugin-store                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Threading rules:**
- Audio thread: cpal callback only — writes to ring buffer, computes one RMS, emits event. Nothing else.
- Analyzer thread: spins on the ring buffer, runs all DSP. Allowed to fall behind (drops oldest, never blocks).
- UI thread: receives Tauri events, renders. Never touches audio data directly.

**No FFI. No C dependencies. No GPU. No model files.**

---

## What We Can Give Feedback On

### Tier 1 — Core (Phase 1-3)

| Metric | What it measures | Why it matters |
|--------|------------------|----------------|
| **Interval consistency** | Std dev of intervals between consecutive onsets | The single best measure of "in the pocket" |
| **Tempo drift** | Trend of intervals over time (rushing/dragging) | Tells you if you speed up/slow down |
| **Hit rate** | % of expected beats with a detected onset | Are you actually playing the notes? |
| **Phase offset** | Best-fit constant shift after calibration | Pure latency vs actual timing error |
| **Per-beat deviation** | Each note's offset from its expected grid point | Per-note feedback for visualization |

### Tier 2 — Quality (Phase 4)

| Metric | What it measures | Why it matters |
|--------|------------------|----------------|
| **Subdivision accuracy** | Same as Tier 1 but for eighths/sixteenths/triplets | Most musicians struggle with subdivisions, not downbeats |
| **Accent dynamics** | Amplitude ratio: accents vs non-accents | Are you actually accenting, or playing flat? |
| **Dynamic consistency** | Std dev of amplitude on non-accented notes | Are unaccented notes evenly controlled? |
| **Attack consistency** | Std dev of spectral centroid at onset | Consistent picking/striking technique |
| **Note clarity** | Spectral flatness ratio between notes vs at notes | Detects buzz, fret noise, sloppy muting |
| **Dead notes** | Onsets with abnormally low amplitude or spectral spread | Catches muffed notes |

### Tier 3 — Advanced (Phase 5+)

| Metric | What it measures | Why it matters |
|--------|------------------|----------------|
| **Stamina / fatigue** | Degradation of consistency over long sessions | Are you sloppier as you tire? |
| **Tempo ceiling** | BPM at which consistency drops below threshold | Your real upper limit |
| **Microtiming pattern** | Does the user always rush 16th notes but drag quarters? | Reveals systemic habits |
| **Rest accuracy** | Silence on beats marked as rests (no bleed) | Important for tight playing |
| **Double-strike detection** | Two onsets too close together when one was expected | Finger fumbles |
| **Groove ratio** (later) | Do swing 8ths actually swing? Triplet ratios? | For genre-aware practice |
| **Crescendo/decrescendo control** | Smooth amplitude ramps over a phrase | For expressive playing |
| **Polyrhythm tracking** (later) | Two streams of onsets in different patterns | Drummers, advanced players |

### Tier 4 — Drum-specific (Future)

| Metric | What it measures |
|--------|------------------|
| **Per-drum classification** | Kick / snare / hi-hat / tom from spectral signature |
| **Limb independence** | How tight is each limb's timing independently? |
| **Ghost note dynamics** | Are quiet notes appropriately quiet? |
| **Flam detection** | Two limbs playing milliseconds apart vs simultaneously |

---

## Phases

### Phase 1 — Foundation (Audio Capture + Calibration)
**Goal:** Reliably capture audio from any input device, calibrate user's latency.

**Deliverables:**
- `src-tauri/src/audio_input.rs`: `cpal` input stream wrapper
- Device enumeration (mic + loopback where supported)
- Lock-free ring buffer (`ringbuf` crate)
- Real-time RMS → `audio-level` event (20 Hz)
- Tauri commands: `list_audio_devices`, `start_audio_capture`, `stop_audio_capture`, `record_test_clip`
- Settings UI: "Experiments → Playing Analysis" with device picker, VU meter, test recorder
- Calibration wizard: 8-beat tap-along, computes offset, saves to settings
- macOS callout for BlackHole installation
- "Audio is processed locally and never written to disk" disclaimer

**Crates added:** `ringbuf`

**Estimate:** 3-4 days

---

### Phase 2 — Onset Detection
**Goal:** Reliably detect when the user plays a note.

**Deliverables:**
- `src-tauri/src/onset.rs`: spectral flux onset detector
- 1024-sample Hann-windowed STFT, 50% overlap
- Adaptive threshold = median(last 1s flux) × multiplier
- Refractory period (50ms minimum between onsets)
- Peak interpolation for sub-frame precision
- Output: `Onset { ts_ns, amp, centroid, sharpness }`
- Test harness: load a WAV file, dump detected onsets, verify against hand-labeled examples
- Tunable parameters via dev menu (threshold, refractory time)

**Crates added:** `realfft`

**Estimate:** 4-5 days (algorithm + tuning across instruments)

---

### Phase 3 — Real-Time Per-Beat Feedback
**Goal:** As you play, you see how you're doing for each beat.

**Deliverables:**
- `src-tauri/src/timing.rs`: metronome-aware alignment + interval analysis
- For each metronome tick, find onset within ±100ms grace window
- Compute deviation (after calibration), interval error (latency-independent), accent strength
- Emit `beat-feedback` event per beat with classification: tight / good / loose / off / missed
- Frontend:
  - Color-tinted beat dots in DrillView and FullscreenView (green/yellow/orange/red/gray)
  - Subtle offset tick mark above each dot (left = early, right = late)
  - Live drift meter (trailing 8-beat average) — small horizontal slider, center = on tempo
  - Optional: numeric per-beat readout in a "details" panel
  - All visualizations are subtle and zen-mode-appropriate

**Estimate:** 4-5 days

---

### Phase 4 — Session Report
**Goal:** Detailed end-of-drill summary with actionable insights.

**Deliverables:**
- `src-tauri/src/session.rs`: aggregator that consumes `BeatRecord`s
- Compute on session end:
  - Hit rate, on-time %, good %, off %
  - Mean & stddev interval error (latency-independent consistency score)
  - Best-fit phase offset (vs configured calibration → suggests re-calibration if drifted)
  - Rushing/dragging score (signed trailing trend)
  - Per-step breakdown for ramps (which BPM was hardest?)
  - Accent accuracy %, dynamic control score, attack consistency score
  - Timing histogram (-100ms to +100ms in 5ms bins)
  - Drift over time (sampled)
  - Letter grade (A/B/C/D/F based on weighted composite)
- Frontend:
  - End-of-drill modal (zen styling, big grade, compact stats)
  - Insights box: 1-3 templated phrases based on dominant pattern
  - "Save to history" / "Discard" / "Re-run this drill" buttons
- Local history via `tauri-plugin-store`:
  - Last 100 sessions with full metrics
  - Trend chart (consistency over weeks)
  - Per-BPM personal bests
- Privacy explainer: "All sessions stored locally. To delete, click here."

**Estimate:** 4-5 days

---

### Phase 5 — Quality Metrics (Tier 2 expansion)
**Goal:** Beyond timing — how clean and dynamic is the playing?

**Deliverables:**
- Subdivision-aware timing (analyze ALL subdivisions, not just downbeats)
- Accent dynamics analysis
- Attack consistency (spectral centroid stddev)
- Note clarity (spectral flatness in note vs gap)
- Dead note detection
- New session report sections: "Dynamics" and "Clarity"
- Per-beat dot coloring optionally reflects clarity, not just timing

**Estimate:** 5-7 days

---

### Phase 6 — Advanced Insights (Tier 3)
**Goal:** Long-term pattern recognition.

**Deliverables:**
- Stamina analysis (consistency over session duration)
- Tempo ceiling detection (auto-suggest a personal "comfort zone" BPM)
- Microtiming pattern report ("you tend to rush 16ths but drag 8ths")
- Practice suggestions based on weakest metric
- Long-term trend dashboard

**Estimate:** 5-7 days

---

### Total core (Phases 1-4)

**~3 weeks of focused work** for a shippable, useful, privacy-first feature.

Phases 5-6 are post-launch enhancements that can be added based on user feedback.

---

## Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| FFT library | `realfft` | Pure Rust, ~30KB, no SIMD assembly issues, real-valued specialization is fast |
| Ring buffer | `ringbuf` | Lock-free SPSC, perfect for audio thread → analyzer |
| FFT size | 1024 samples | Good balance: 21ms window @ 48kHz, captures bass fundamentals (~50Hz) |
| Hop size | 512 samples | 50% overlap, ~10ms hop gives 100Hz onset resolution |
| Sample rate | Use whatever cpal gives us | Don't resample unless necessary; algorithm is sample-rate-agnostic |
| Threading | Dedicated analyzer thread, lock-free queue from audio thread | Never block audio. Allow analyzer to drop frames if behind. |
| Persistence | `tauri-plugin-store` (already a planned dep) | Local JSON, no DB, privacy-pure |
| Timing source | `std::time::Instant` for monotonic ns timestamps | Same clock the metronome engine uses |

**No new heavy dependencies. No GPU code. No async runtime additions.**

---

## Performance Budget

| Component | Target | Rationale |
|-----------|--------|-----------|
| Audio capture latency | < 20ms | cpal default buffer |
| Onset detection latency | < 30ms after onset | One frame + processing |
| Visual feedback latency | < 80ms after onset | Onset + timing analysis + IPC + render |
| Steady-state CPU | < 5% on M1, < 10% mid-laptop | Background-friendly |
| RAM overhead | < 50MB | Ring buffer + FFT scratch + session log |
| Battery delta | < 2× baseline | Won't murder laptop battery |
| Bundle size impact | < 200KB total | realfft + ringbuf + small Rust code |

Optimizations:
- Skip frames if backed up (analyzer drops, never blocks audio)
- Disable analysis when window is hidden / app is in tray
- Pre-allocate everything; zero allocations in DSP loop
- Optional: only run analyzer when metronome is playing (saves CPU when idle)

---

## Privacy & Marketing

Lean hard into the privacy story. This is the differentiator.

**In-app:**
- One-shot privacy explainer when feature is first enabled
- Mic indicator in UI when capture is active (extra trust signal)
- "All processing local. No network access. No telemetry. View source: [GitHub link]"
- Easy "Delete all session history" button in settings

**External:**
- Landing page section: *"The first metronome that grades your playing — without spying on you"*
- Blog post when launched: technical deep-dive into how it works (great for HN/Reddit/musician forums)
- Compare vs Yousician/Melodics: *"They send your audio to their servers. We don't even have servers."*

This positioning could justify making it a paid Pro feature later.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Click bleed into mic triggers false onsets | Subtract known click waveform via phase cancellation, OR detect onsets near beat positions and verify they're not just the click echo via cross-correlation |
| User has no audio interface | Mic-only mode works fine for acoustic instruments; degraded for electric players (still works for clean tones) |
| Drummer plays multiple drums per beat | Phase 4: detect cluster onsets and treat as a "hit group" rather than counting each drum |
| Excessive latency masks real timing errors | Calibration handles systematic offset; interval analysis handles the rest |
| Background noise triggers onsets | Adaptive threshold + minimum amplitude gate + spectral feature filter (must look like an instrument transient) |
| Audio device disappears mid-session | Detect, pause analysis, surface error toast, attempt reconnect |
| User is on Windows with WASAPI loopback issues | Fall back to mic, surface device list with warnings |
| Performance regression on slow machines | Performance test in CI; auto-disable feature with notice if frame budget exceeded |

---

## Existing Metronomes With Playing Feedback

**TL;DR: Almost no one does this for metronome practice. This is a real gap in the market.**

| App | Platform | Has playing analysis? | Notes |
|-----|----------|----------------------|-------|
| **Pro Metronome** | iOS / Android / Mac | ❌ No | Most popular paid metronome; pure click+visual, no listening |
| **Tempo (Frozen Ape)** | iOS / Android | ❌ No | Solid metronome, no analysis |
| **Soundbrenner Metronome** | iOS / Android | ❌ No | Their innovation is the wearable Pulse vibration device, not analysis |
| **The Metronome by Soundbrenner** | iOS / Android | ❌ No | Free, basic |
| **Metronome Plus / Beats** | Various | ❌ No | Basic metronomes |
| **TonalEnergy Tuner & Metronome** | iOS / Mac | ⚠️ Partial — pitch only | Has tuner with intonation analysis, but no rhythm/timing feedback |
| **Modacity** | iOS / Mac | ⚠️ Partial — recording only | Records practice, but no automated timing analysis |
| **Yousician** | iOS / Android / Mac / Win | ✅ Yes — but it's a song lessons app | Listens to you play through songs, scores accuracy. Not a metronome practice tool. Subscription ~$20/mo |
| **Melodics** | Mac / Win | ✅ Yes — but it's drum/keys lessons | Same as Yousician but for drums/finger drumming/keys. Subscription ~$15/mo |
| **Soundslice** | Web | ✅ Yes — sheet music context | Reads notation and grades playing. Not a metronome. ~$10/mo |
| **Drumeo BandHub** | Web | ⚠️ Limited — for community jams | Some accuracy feedback but not focused on timing analysis |
| **Drum School / Drumeo Edge** | Web / Mobile | ⚠️ Limited | Lesson-focused, basic feedback |
| **Trinity Audio Metronome (acad.)** | Research | ✅ Yes | Academic prototypes exist but no shipping consumer product |

**Key takeaways:**
- **No mainstream metronome offers real-time playing analysis.** This is genuinely white space.
- The apps that DO listen to playing (Yousician, Melodics, Soundslice) are **lesson/song platforms with subscriptions**, not practice metronomes. They lock features behind paywalls (~$10-25/month).
- **None of them are privacy-focused.** All send audio to their servers for processing.
- The closest analog is **TonalEnergy** ($4.99 one-time), which has *pitch* analysis (intonation) but not *timing* analysis. They've left rhythm feedback as a clear gap.

**Implication:** Yames could legitimately claim to be:
1. The first metronome (vs lesson platform) with playing analysis
2. The first such tool with privacy-first, on-device processing
3. The cheapest serious option (free or one-time purchase vs $15-25/month)

This is a genuine moat if executed well.

---

## Open Questions

1. **Should real-time feedback be visible during a drill or only after?** Some users will find live indicators distracting. Make it a toggle: "Show live feedback during drills" on/off.
2. **Should we save raw audio?** Default no — privacy. Optional per-session "save recording" button for users who want to review.
3. **Pro feature or free?** Could be a way to monetize. Could also be the marquee free feature that drives adoption. Suggest: free with optional "Pro" detailed analytics history.
4. **Calibration UX:** Should it be required, or hidden in settings? Suggest: prompt on first enable, otherwise hidden.
5. **What happens during ramps where BPM changes?** Reset interval baseline at each step transition. Track per-step stats separately.

---

## Companion Plan: AI Backlog

See [`AI_EVALUATION_BACKLOG.md`](AI_EVALUATION_BACKLOG.md) for future AI-augmented features that build on top of this DSP foundation.
