# DSP Accuracy & Coach Intelligence — Plan

> **Status:** Active. This is the next major work area.
> **Depends on:** `PLAYING_EVALUATION_PLAN.md` (Phases 1-7 shipped)

---

## The Two Pillars

In order of importance:

1. **Great scoring** — onset detection, beat matching, and scoring must be accurate
   across all tempos and playing styles, or the entire feature crumbles.
2. **Life-like coach** — comments when it matters, gives productive feedback,
   references your history, doesn't repeat itself. If the sentences feel hardcoded,
   users disengage.

These reinforce each other: the coach can only be as smart as the data it receives,
and the data is only useful if someone interprets it well.

---

## Current State (as of 2026-05-15)

### What's Shipped
- Audio input capture (cpal, ring buffer, 16-band spectrum)
- Onset detection (spectral flux + Goertzel, adaptive threshold)
- Auto-calibration (running median, 16-sample window, ~8 beat convergence)
- Beat matching (±200ms window, calibration-adjusted)
- Grid correlation (continuous 0-1, subdivision-aware)
- Per-beat feedback (perfect/good/ok/miss/skipped)
- Session accumulator → SessionReport (grade S-F, score 0-100, insights)
- Session history (last 30 sessions, tauri-plugin-store)
- Practice Coach card (floating panel, feed, chat, history tab)
- Template-based coach (greeting, mini-report, summary, chat)
- TTS with 3 Piper voices + chime mode
- Adaptive drill (model-driven or heuristic tempo)
- Async Tauri commands (no UI freeze)

### Critical Problems

**1. Beat matching breaks at fast tempos.**
At 200 BPM 16th notes, beats are 75ms apart. The ±50ms matching window *overlaps
adjacent beats* — every random onset matches something. The matching layer is not
tempo-aware.

**2. Scoring rewards random playing.**
`hit_rate * 0.3 + accuracy * 0.5 + consistency * 0.2` — random noodling gets free
points from the hit_rate component because at any tempo, some onsets land near beats
by pure chance. No penalty for extra/spurious onsets between beats.

**3. Interval analysis is underweighted.**
The original architecture insight was "spacing matters more than absolute position."
A player with perfectly even 16ths shifted 20ms from the grid is playing well
(just latency). A player with random spacing where some notes land on the grid by
chance is playing terribly. The current formula doesn't reflect this.

**4. No diagnostic visibility.**
Can't see what the DSP detected, how it matched onsets to beats, or why a score
feels wrong. Tuning the formula is guesswork.

**5. Coach has no session narrative.**
The model sees a snapshot of metrics at query time. It doesn't know the session
story: "started strong at 120, accuracy dropped when drill pushed to 140, recovered
after slowing to 130." This makes mid-session comments and end-of-session summaries
shallow.

**6. Coach has no memory across sessions.**
Greetings are generic. No awareness of past sessions, presets, or trends. The
template engine doesn't understand context beyond the current moment.

---

## Pillar 1: Great Scoring

### D1 — Diagnostic Logging

Can't fix what you can't see. This unblocks everything else.

**What to capture per session:**

```rust
SessionLog {
    bpm: u16,
    time_signature: u8,
    subdivision: u8,
    timestamp: u64,
    duration_ms: u64,

    // Ground truth: when beats were expected
    expected_beats: Vec<ExpectedBeat>,  // { index, timestamp_ms, is_accent }

    // Raw detections: what the onset detector found
    detected_onsets: Vec<DetectedOnset>,  // { timestamp_ms, amplitude, centroid, confidence }

    // Matching decisions: how onsets were paired to beats
    matches: Vec<MatchDecision>,  // { beat_index, onset_index?, deviation_ms, classification, reason }

    // Unmatched onsets: detected but not near any beat
    spurious_onsets: Vec<u32>,  // indices into detected_onsets

    // Activity state transitions
    activity_transitions: Vec<ActivityTransition>,

    // Final report
    report: SessionReport,
}
```

**Testing strategy:** Alongside the logging structs, build **synthetic test
helpers** that construct fake `BeatFeedback` sequences. This lets us write Rust
unit tests with known inputs and expected score ranges — formula iteration in
seconds instead of minutes of playing.

Example test cases:

```rust
#[test]
fn perfect_playing_scores_95_plus() {
    let feedbacks = generate_perfect_beats(32, 120); // 32 beats at 120 BPM
    let report = score_feedbacks(&feedbacks);
    assert!(report.score >= 95);
}

#[test]
fn random_noodling_scores_below_30() {
    let feedbacks = generate_random_onsets(32, 120, 3.0); // 3x more onsets than beats
    let report = score_feedbacks(&feedbacks);
    assert!(report.score < 30);
}
```

**Storage:** JSON in app data dir (`session_logs/`), auto-prune to last 50.
Add `export_session_logs` command for analysis. These are dev/debug artifacts,
not user-facing.

### D2 — Onset Detection Hardening

Fix detection before tuning the formula. Bad detection data makes formula
tuning pointless — you'd compensate for detection errors, then when you fix
detection later, the formula is wrong again.

**Adaptive refractory period:**
- Current: fixed 50ms minimum between onsets.
- Problem: at 200 BPM 16ths, inter-onset is 75ms. 50ms refractory eats 67%
  of the window. Fast rolls and articulations get swallowed.
- Fix: refractory = `max(20ms, subdivision_interval * 0.35)`.
  At 120 BPM quarters (500ms interval) → 175ms refractory (generous).
  At 200 BPM 16ths (75ms interval) → 26ms refractory (tight but real).
- The 20ms floor is physics — no real instrument produces two distinct attacks
  faster than that.

**Adaptive noise floor:**
- Current: hardcoded RMS threshold of 0.01.
- Problem: quiet instruments miss onsets; noisy environments trigger false ones.
- Fix: measure ambient RMS during first 2 seconds after audio starts (before
  playing begins). Set noise floor to `ambient_rms × 3`. Re-measure when
  signal drops below threshold for >5 seconds (player stopped).

**Onset confidence scoring:**
- Add `confidence: f32` (0.0-1.0) to each onset.
- Based on: amplitude-to-noise ratio, spectral flux peak sharpness, distance
  above adaptive threshold.
- Low-confidence onsets get less weight in scoring (not discarded — they still
  count, just contribute less certainty to the grade).

**Click cancellation — deferred.**
Most practice setups (headphones, audio interfaces) have zero click bleed.
The case where it matters (laptop mic + laptop speakers) is the weakest
evaluation setup anyway. The adaptive noise floor + amplitude threshold
already filter most bleed. Revisit only if users report it as a problem.

### D3 — Scoring Architecture Overhaul

This is the critical piece. The current scoring has three fundamental flaws:
fixed-width matching windows, no spurious onset tracking, and underweighted
interval analysis. All three must be addressed together.

#### 3a. Tempo-Aware Matching Windows

**The problem in detail:**

| Tempo | Subdivision | Beat interval | ±50ms window coverage |
|-------|-------------|--------------|----------------------|
| 60 BPM | Quarter | 1000ms | 10% — fine |
| 120 BPM | Quarter | 500ms | 20% — acceptable |
| 120 BPM | 8th | 250ms | 40% — generous |
| 180 BPM | 16th | 83ms | 120% — **windows overlap** |
| 200 BPM | 16th | 75ms | 133% — **completely broken** |

**Fix:** Matching window = fraction of beat interval, not fixed ms.

```
window_ms = min(beat_interval_ms * 0.4, 80ms)
```

At 120 BPM quarters: min(200, 80) = 80ms — similar to today.
At 200 BPM 16ths: min(30, 80) = 30ms — tight, no overlap.

Classification thresholds also scale:

```
perfect = window_ms * 0.20   (at 120 BPM: <16ms, at 200 BPM 16ths: <6ms)
good    = window_ms * 0.50   (at 120 BPM: <40ms, at 200 BPM 16ths: <15ms)
ok      = window_ms * 0.80   (at 120 BPM: <64ms, at 200 BPM 16ths: <24ms)
miss    = outside window
```

This naturally tightens expectations at fast tempos — which is correct,
because at 200 BPM 16ths you genuinely need to be more precise.

#### 3b. Spurious Onset Tracking

**The core insight:** A disciplined player produces roughly as many onsets as
there are beats. A random noodler produces many more. This ratio is the single
most powerful signal for detecting bad playing.

```
onset_efficiency = matched_onsets / total_detected_onsets
```

- Disciplined player: 32 onsets for 32 beats → efficiency 1.0
- Random noodler: 47 onsets for 16 matched beats → efficiency 0.34
- Player with ghost notes: 40 onsets for 32 beats → efficiency 0.80

**Handling legitimate extra onsets:**
- Ghost notes, grace notes, ornaments are usually quieter than beat-aligned
  notes. Weight spurious onset penalty by amplitude: loud unmatched onsets
  penalize more than quiet ones.
- Double-strikes near the same beat: allow multiple onsets per beat, score
  only the best match. Additional onsets near the same beat are neutral
  (neither rewarded nor penalized). Only onsets far from ANY beat penalize.

#### 3c. Interval-First Scoring

**The fundamental insight (from the original architecture):** "Latency doesn't
matter, spacing does." A player with perfectly even note spacing but a fixed
offset from the grid is playing well. A player with erratic spacing where some
notes accidentally land on the grid is playing poorly.

**New formula (proposed):**

```
interval_consistency  × 0.35  — are your notes evenly spaced?
grid_alignment        × 0.25  — after calibration, do they align with beats?
hit_completeness      × 0.20  — are you hitting all expected beats?
onset_efficiency      × 0.20  — are you playing only the notes you should be?
```

**Interval consistency (0-100):**
Standard deviation of (actual_interval - expected_interval) across consecutive
onset pairs. Lower std = more consistent = higher score. This is completely
latency-independent.

**Grid alignment (0-100):**
Weighted average of classification scores (perfect=100, good=80, ok=50,
miss=0) across matched beats. Same as today's `accuracy_score` but with
tempo-aware thresholds from 3a.

**Hit completeness (0-100):**
`matched_beats / expected_beats`. Simple hit rate, but only counting beats
where the player was active (after activity detection removes idle periods).

**Onset efficiency (0-100):**
`matched_onsets / total_onsets`, with quiet spurious onsets penalized less
(amplitude-weighted). Score of 1.0 = no wasted notes. Score of 0.3 = lots
of random noise.

**Why these weights:**
- Interval consistency at 0.35 because it's the most robust metric — immune
  to latency, directly measures "can you keep time?"
- Grid alignment at 0.25 because it matters but is sensitive to calibration
  quality.
- Hit completeness at 0.20 because missing beats matters, but it's a coarse
  metric (you either hit it or you didn't).
- Onset efficiency at 0.20 because spurious onsets are the main signal that
  distinguishes random playing from structured playing.

#### 3d. Validation Test Matrix

Every formula change must pass these. Implemented as Rust unit tests.

| # | Scenario | Expected Score | What Breaks If Wrong |
|---|----------|---------------|---------------------|
| 1 | Perfect on every beat, 120 BPM | 95-100 | Baseline sanity |
| 2 | Perfect but miss every other beat | 45-55 | Hit completeness weight |
| 3 | Random onsets, 3× beat count | < 25 | Onset efficiency + interval |
| 4 | Random onsets, accent on beat 1 only | < 35 | The known bug |
| 5 | All beats hit, consistently 30ms late | 75-85 | Calibration tolerance |
| 6 | Perfect for 8 bars, then stop | 90+ | Activity detection |
| 7 | Double-time (2 onsets per beat) | 70-80 | Double-strike handling |
| 8 | < 8 beats total | No grade | Minimum data gate |
| 9 | Perfect 16ths at 180 BPM | 90+ | Fast-tempo window scaling |
| 10 | Random 16ths at 180 BPM | < 25 | Fast-tempo discrimination |
| 11 | Even spacing, offset from grid | 70-80 | Interval vs grid separation |
| 12 | Grid-aligned but erratic spacing | 50-60 | Interval consistency weight |

### D4 — Activity Detection Refinement

**Pause tolerance:** Allow N beats of silence before transitioning to Resting.
N scales with time signature (a 4-bar rest in 3/4 is intentional phrasing).

**Segment boundaries:** When grid correlation changes significantly (0.9 → 0.1),
or BPM changes, or there's a gap >10 seconds — mark a segment boundary. Each
segment gets scored independently and contributes to the final weighted average.

---

## Pillar 2: Life-Like Coach

### C1 — Session Narrative

**The gap:** The model currently sees a snapshot of metrics at query time. It
doesn't know the story of the session. This is why comments feel generic —
there's no arc, no before-and-after, no trajectory.

**A session narrative** is a compact running log maintained on the JS side:

```
Session timeline:
0:00 — Started at 120 BPM (preset: Spider Exercise, last session: 88% at 135 BPM)
2:30 — Segment 1 complete: 91% accuracy, solid pocket, slight rushing on beat 3
3:00 — Drill started, linear ramp 120→160
5:15 — Segment 2 complete: accuracy dropped to 68% above 140 BPM
5:20 — Coach: "Consistency drops above 140 — try isolating beats 2-3 slower"
7:00 — Segment 3 complete: 84% accuracy at 135 BPM, beat 3 improved
```

This is tiny (a few hundred bytes) and fits easily in any model's context.
It gets appended after each segment end, coach comment, or significant event.

**Every model query includes the narrative.** Whether it's a mini-report,
end-of-session summary, or chat answer — the model sees the full story. This
enables comments like:
- "Your beat 3 has been improving since I mentioned it earlier"
- "You recovered well after the accuracy dip at 140 — good adjustment"
- "This is your third session this week on Spider Exercise, and you're
  consistently faster than last week"

The `segmentReportsRef` already tracks segment data on the JS side. Turning
it into a text narrative is straightforward.

### C2 — Context-Aware Greetings

**Greeting context hierarchy:**

1. **Preset with history:** Reference their trend, last score, suggest a target.
   "Back at Spider Exercise — you hit 88% at 135 BPM last time. Let's see
   if 140 is within reach today."
2. **Preset, first time:** Reference the preset name and set expectations.
   "First session with [preset name]. Let's establish a baseline."
3. **No preset, has recent sessions:** Reference recent work.
   "Welcome back. You've been putting in solid work this week."
4. **No preset, no history:** Simple, warm, no assumptions.
   "Play when you're ready — I'll track your timing."

**Implementation:**
- JS side: always build and pass session history context in greeting calls,
  regardless of whether template or LLM mode is active.
- Template engine: parse the structured context (session count, trend, last
  score, preset name) and select from a pool of greeting templates.
- LLM mode: pass the full context including preset name — the model naturally
  infers meaning from names like "Warm Up" vs "Speed Challenge."

**On preset names:** The LLM handles these naturally. The template engine should
not try to parse preset name semantics — just use the name as a label. If the
name happens to be meaningful, the LLM benefits. If it's "Groove 3", the LLM
gracefully ignores it. No keyword-matching heuristics needed.

### C3 — Preset Awareness

**Preset change mid-session:**
When the user switches presets during a session, inject an acknowledgment:
- System message: "Switched to [Preset Name]"
- Coach comment (if history exists): "Your best here is 92% at 130 BPM."

This teaches the user that the coach is preset-aware and tracking per-exercise
progress.

**Preset history summaries (already partially built in `compactPresetSummary`):**

Add recurring issue detection:
- BPM threshold where accuracy drops (find the BPM where score < 70%)
- Timing tendency across sessions (mean deviation sign: rushing vs dragging)
- Stamina pattern (does accuracy degrade in later segments?)

These are computed on-the-fly from saved sessions. No separate storage needed.

### C4 — Smart Coaching Timing

**Current:** Hardcoded — check every 8 beats, 15s cooldown, trigger at 3 misses.

**Problem:** Too frequent during good playing (annoying), too infrequent during
critical moments (misses the chance to help).

**Architecture: heuristic gatekeeper + model content.**

The heuristic layer (cheap, runs every N beats) decides: "something notable
just happened." Notable events:
- Accuracy dropped significantly (>20% over 16 beats)
- New personal best streak
- Clear rushing/dragging trend developing
- Recovery after a rough patch
- Fatigue signal (accuracy declining over several minutes)
- Tempo milestone in adaptive drill

When the heuristic fires, it sends the full session narrative + current
metrics to the model: "Given this session so far, is this worth commenting on?
If so, what should I say?"

The model can:
- Generate a contextual comment (the common case)
- Decide "actually, I just said something 30 seconds ago, skip this one"
- Adjust urgency (important enough for TTS, or just feed text?)

**Why 0.8s inference latency is fine:** Coaching comments aren't time-critical.
A tip that arrives 1 second after a notable moment is perfectly natural. The
user doesn't expect instant reaction — they expect thoughtful observation.

**Template fallback:** When LLM is not available, the heuristic layer generates
content directly using the existing template pool. The architecture is the
same — the heuristic decides WHEN, the template/LLM decides WHAT.

**Adaptive cooldown:**
- After a comment, minimum cooldown before next = `max(20s, time_since_session_start * 0.1)`
- Early in session: more comments (establishing rapport). Later: less frequent
  (let them play). This naturally mirrors how a real coach behaves.
- If the user responds in chat, reset cooldown (they're engaged, keep talking).

### C5 — Coach Personality

**Template engine improvements:**
- Pool of 3-5 templates per scenario, selected randomly (no repetition in
  same session). Current engine has exactly 1 template per case.
- Templates reference specific metrics when available: "your beat 3 timing
  improved" instead of generic "keep it up."
- Track last N comments in the session to avoid repeating the same advice.

**LLM mode:**
- System prompt already constrains the coach persona. The key improvement is
  **richer context** — session narrative, preset history, recurring issues.
- The model naturally varies phrasing and avoids repetition when given good
  context. The work here is context preparation, not prompt engineering.

**What makes a coach feel human:**
- References the past: "last week you struggled with this tempo"
- Notices change: "your consistency has been improving all session"
- Gives specific advice: "try accenting beat 3 harder to lock in"
- Knows when to shut up: long stretches of good playing → silence
- Celebrates: "first time above 90% at this tempo — that's a milestone"

---

## Sequencing

```
Phase 1: D1 (Diagnostic Logging) ←── unblocks everything
    ↕ in parallel
Phase 1: C2 (Context-Aware Greetings) ←── quick win, no DSP dependency

Phase 2: D2 (Onset Detection Hardening) ←── fix detection before scoring

Phase 3: D3 (Scoring Architecture) ←── with synthetic unit tests
         D3 validated against test matrix (12 scenarios)

Phase 4: C1 (Session Narrative) + C3 (Preset Awareness)
         Coach gets full session context

Phase 5: C4 (Smart Coaching Timing)
         Heuristic gatekeeper + model content

Phase 6: D4 (Activity Detection) + C5 (Coach Personality)
         Polish and refinement
```

Phases 1-3 are the foundation. If scoring is wrong, nothing else matters.
Phases 4-6 make the coach smart. Each phase is independently shippable.

---

## Future AI Features (Backlog)

Only pursue if DSP can't solve them AND there's clear user demand.

| Feature | What | When |
|---------|------|------|
| Multi-drum classification | Identify kick/snare/hat per onset | When drummer users ask |
| Technique classification | Detect picking styles, articulations | After user base grows |
| Note pitch detection | Polyphonic transcription | Different product scope |
| Click cancellation | Remove metronome bleed from input | If users report bleed issues |

---

## Assumptions, Edge Cases & Open Questions

These are the places where the plan could break. A reviewer should check
whether each assumption holds and whether each edge case has a viable answer.

### Scoring & DSP

**1. Window fraction (0.4) needs empirical validation.**
The formula `min(beat_interval * 0.4, 80ms)` was chosen analytically, not
measured. The 0.4 factor assumes that 40% of the beat interval is a reasonable
match window. This might be too tight for beginners or too loose for advanced
players. Validate with the test matrix (D3d) — if scenarios 9/10 (180 BPM
16ths) don't produce a clean pass/fail separation, the fraction needs tuning.
Start with 0.4, but treat it as a configurable constant, not a magic number.

**2. Subdivision playing vs onset efficiency.**
If the grid is set to quarter notes but the player is playing 8ths (common in
practice), every off-beat onset is "spurious" under the current definition.
The grid correlation metric already detects this (high correlation at 2×
subdivision = double-time playing). When grid correlation at a harmonic
subdivision exceeds 0.7, adjust `expected_onsets` to include that subdivision.
Otherwise onset_efficiency unfairly penalizes musical playing.

**3. Interval consistency must measure against expected interval at each BPM step.**
During adaptive drills, BPM changes mid-segment. If interval consistency
measures deviation from a global average interval, it will penalize perfectly
timed playing at different tempos. The expected interval must update in
real-time with the current BPM. Store the expected BPM at each beat so the
interval deviation is always `actual_interval - expected_interval_at_that_beat`.

**4. Calibration carry-over between presets.**
Auto-calibration converges in ~8 beats. If the user switches presets (and
potentially instruments or positions), stale calibration offsets will
misclassify the first 8 beats. Options:
- Reset calibration on preset switch (accurate but 8 beats of noise).
- Keep calibration if same audio device (assumes similar latency).
- Recommendation: reset, but exclude the convergence period from scoring.

**5. Swing/shuffle breaks the even-subdivision assumption.**
Interval consistency assumes evenly spaced subdivisions. In swing feel,
alternating long-short 8ths are intentional. This is a backlog feature
(item #4 on the roadmap), but the scoring architecture must not make it
impossible to add later. The fix: interval consistency compares against
an `expected_interval` array, not a single constant. For straight time,
all expected intervals are equal. For swing, they alternate. The formula
works unchanged — only the expected values differ.

**6. Test scenarios 11 and 12 need precise synthetic definitions.**
Scenario 11 (even spacing, offset from grid) and 12 (grid-aligned but erratic
spacing) are designed to validate that the formula correctly separates interval
consistency from grid alignment. Define precisely:
- **Scenario 11:** 32 beats, each onset exactly 25ms late (constant offset).
  Interval consistency = perfect (σ = 0). Grid alignment = degraded (~good
  classification). Expected score: 70-80 (interval dominates).
- **Scenario 12:** 32 beats, onsets randomly jittered ±40ms but mean-centered
  on each beat. Interval consistency = poor (high σ). Grid alignment = decent
  (mean is on-beat). Expected score: 50-60 (interval penalty outweighs grid).

If the formula doesn't produce this ordering (11 > 12), the interval weight
(0.35) is too low or grid weight (0.25) is too high.

**7. Minimum data gate.**
Scenario 8 says "< 8 beats → no grade." But what about 9 beats? 15? At what
point do we trust the metrics enough to show a percentage? Proposal: below 16
beats, show only qualitative feedback ("too short to score — play longer for
a full report"). Between 16-32, show score but flag as "preliminary." Above 32,
full confidence. These thresholds should be constants, not hardcoded.

### Coach & Context

**8. Session narrative size cap.**
The narrative grows with session length. A 30-minute session with frequent
events could produce several KB. Cap the narrative at ~2KB (~50 entries).
When it exceeds the cap, truncate the oldest entries but keep: the session
start line, the first and last segment summary, and the most recent 40 entries.
This preserves the arc (start → middle → now) without unbounded growth.

**9. Adaptive cooldown should cap, not grow unbounded.**
The formula `max(20s, time_since_session_start * 0.1)` means at 10 minutes
into a session, the cooldown is 60s. At 30 minutes, it's 180s — three minutes
between comments. That's too quiet. Cap the cooldown at 60 seconds:
`min(60s, max(20s, time_since_session_start * 0.1))`.

**10. Minimum comment frequency.**
Even during great playing, total silence for 5+ minutes feels like the coach
is asleep. Add a floor: if no heuristic event fires for 5 minutes of active
playing, trigger a low-priority "check-in" — a brief encouraging remark or
progress note. This keeps the coach present without being annoying.

**11. Template rotation must avoid repetition.**
"Pool of 3-5 templates per scenario, selected randomly" can repeat the same
template twice in a row with bad luck. Use a shuffle-bag instead: put all
templates in a bag, draw without replacement, refill when empty. This
guarantees maximum variety before any repetition.

**12. Minimum session count for recurring issue detection.**
C3 mentions detecting "BPM threshold where accuracy drops" and "timing tendency
across sessions." These analyses need a minimum sample size. With 1-2 sessions,
any pattern is noise. Require at least 3 sessions with a preset before
surfacing recurring patterns. Below that, only report per-session observations.

**13. Double-strike near beat boundary.**
D3b says "allow multiple onsets per beat, score only the best match." But what
if two onsets straddle the boundary between beats — onset A is 20ms before
beat N, onset B is 10ms after beat N? Both are near beat N, but onset A is
also near beat N-1. The matching algorithm must be greedy from the beat's
perspective: assign each onset to its nearest beat, then for each beat, keep
only the closest onset. Process in temporal order to avoid ambiguity.

**14. Confidence threshold for coaching.**
D2 adds onset confidence scores. How does this flow into coaching? If half the
onsets are low-confidence, should the coach caveat its feedback? Proposal:
if mean onset confidence is below 0.5, the coach should mention that the
signal was unclear: "Hard to hear you clearly — try getting closer to the
mic or reducing background noise." This prevents confidently wrong coaching.

### Cross-Cutting

**15. Template vs LLM consistency.**
The template engine and LLM engine receive the same context but produce
very different quality output. Users who try the LLM, unload it, then fall
back to templates will feel a quality cliff. Mitigation: make templates as
context-aware as possible (C2 and C5), and clearly label the mode in the UI
so the quality difference isn't surprising.

**16. Latency during adaptive drill tempo changes.**
During drill ramps, BPM changes every few bars. The matching window must
update immediately with the new BPM — if it lags even one beat, the first
beat at the new tempo gets mis-scored. The expected_beats array must be
regenerated (or interpolated) on each tempo change event, not on a timer.

---

## Principles

1. **Scoring accuracy is existential.** If the score feels wrong, users lose
   trust in everything — the coach, the reports, the app. This is #1 priority.
2. **The coach is a translator, not an analyst.** DSP does all analysis. The
   model translates structured metrics into human language with personality.
3. **Interval consistency is the north star metric.** Can you keep even time?
   This single measurement is more robust than any other — immune to latency,
   directly measures musicianship.
4. **A coach that remembers is a coach that feels real.** Session narratives
   and history summaries are the difference between "stats that talk" and
   "a person who knows you."
5. **Privacy is the moat.** 100% local. No cloud. No telemetry. Ever.
6. **Test with synthetic data first.** Playing by hand is slow and subjective.
   Rust unit tests with known inputs make formula iteration fast and
   deterministic. Real-world testing validates, but doesn't drive, the tuning.
