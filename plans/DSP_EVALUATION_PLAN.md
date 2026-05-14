# Plan: DSP Scoring System — Evaluation & Improvement Methodology

## Problem Statement

The current scoring system gives high grades (e.g., 84) to playing that includes random notes timed poorly as long as accents land correctly. This means the scoring weights accent detection too heavily and/or doesn't properly penalize rhythmic inaccuracy.

Before fixing the system, we need a rigorous way to **evaluate** it — capture detailed logs of what the DSP sees, what decisions it makes, and compare against human judgment of "was this actually good?"

---

## Phase 1: Add Diagnostic Logging (Implement First)

### What to log per session

Add a **detailed session log** that captures the raw DSP decision-making, saved as a JSON file alongside the session report.

**File: `src-tauri/src/session.rs` or new `src-tauri/src/session_log.rs`**

```rust
struct SessionLog {
    // Metadata
    bpm: u16,
    time_signature: u8,
    timestamp: u64,
    duration_ms: u64,

    // Raw beat events from the metronome (ground truth)
    expected_beats: Vec<ExpectedBeat>,

    // Raw onset events from the detector
    detected_onsets: Vec<DetectedOnset>,

    // Matching decisions (how onsets were paired to beats)
    matches: Vec<MatchDecision>,

    // Activity state machine transitions
    activity_transitions: Vec<ActivityTransition>,

    // Final report (for reference)
    report: SessionReport,
}

struct ExpectedBeat {
    index: u32,
    timestamp_ms: f64,      // when the beat occurred
    is_accent: bool,        // beat 1 of measure
    is_subdivision: bool,
}

struct DetectedOnset {
    timestamp_ms: f64,      // when onset was detected
    rms: f32,               // signal level at onset
    spectral_centroid: f32,  // frequency content (optional)
    confidence: f32,        // onset detection confidence
}

struct MatchDecision {
    beat_index: u32,
    onset_index: Option<u32>,  // None = miss
    deviation_ms: f64,
    classification: String,    // "perfect", "good", "ok", "miss", "skipped"
    reason: String,            // why this classification (e.g., "within 10ms window")
}

struct ActivityTransition {
    timestamp_ms: f64,
    from: String,  // "idle", "active", "resting"
    to: String,
    reason: String,
}
```

### Where to store

- Save to: `~/.yames/session_logs/<session_id>.json`
- Keep last 50 logs (auto-prune oldest)
- Include a CLI/command to export all logs as a single JSON for analysis

### Implementation touches

- `src-tauri/src/timing.rs` — emit match decisions with reasoning
- `src-tauri/src/onset.rs` — emit onset events with confidence/RMS
- `src-tauri/src/session.rs` — accumulate into SessionLog, serialize on stop
- `src-tauri/src/commands.rs` — add `export_session_logs` command

---

## Phase 2: Test Scenarios (Run These Tomorrow)

Design specific test cases that expose scoring weaknesses:

| # | Scenario | Expected Grade | What It Tests |
|---|----------|---------------|---------------|
| 1 | Play perfectly on beat, every beat | 95-100 | Baseline — system can give perfect scores |
| 2 | Play perfectly but miss every other beat | 50-60 | Miss penalty weight |
| 3 | Play random notes, ignoring beat entirely | < 30 | Should catch non-rhythmic playing |
| 4 | Play random notes but accent on beat 1 | < 40 | **The bug you found** — accents shouldn't save a bad performance |
| 5 | Play consistently 30ms late (every beat) | 70-80 | Consistent offset shouldn't be heavily penalized |
| 6 | Play perfectly for 8 bars, then stop | 90+ | Resting/idle shouldn't penalize |
| 7 | Play double-time (2 hits per beat) | ??? | How does extra hits affect scoring? |
| 8 | Single loud hit, then silence | < 20 | Edge case: minimal data |

For each scenario:
1. Run it with logging enabled
2. Save the session log
3. Note your human judgment ("this deserves a 30, system gave 84")

---

## Phase 3: AI Analysis Session (What We Do Together)

After gathering logs from Phase 2:

### Step 1: Read the raw logs
I'll read each session log JSON and reconstruct what happened:
- Timeline of expected beats vs detected onsets
- Which onsets matched which beats, and why
- Where the scoring algorithm was generous/harsh

### Step 2: Identify scoring formula issues
Current scoring formula (from `session.rs`):
- Base: hit rate (hits / total beats)
- Bonus: weighted by classification (perfect=1.0, good=0.8, ok=0.5)
- Penalty: consistency penalty from stdDev
- Penalty: tempo stability

Questions to answer from logs:
- Is the window too wide? (±50ms for "ok" might be too forgiving)
- Does the activity state machine correctly ignore idle periods?
- Are extra/spurious onsets penalized at all?
- Is the accent detection inflating scores?
- Should there be a "rhythmic coherence" metric (are hits evenly spaced)?

### Step 3: Propose formula changes
Based on findings, propose specific changes:
- Adjusted thresholds (perfect/good/ok windows)
- New penalty factors (e.g., spurious hit penalty)
- New metrics (e.g., rhythmic coherence score, based on interval variance)
- Activity detection improvements

### Step 4: Re-run scenarios with new formula
- Apply changes
- Re-run the same test scenarios
- Compare grades before/after
- Verify the problematic cases now grade correctly

---

## Phase 4: Ongoing Calibration

After initial fixes, keep the logging system for ongoing tuning:
- Every session automatically logs
- Periodically review edge cases where user's "gut feeling" disagrees with the score
- Use logs to train intuition about what the system sees vs what the human hears

---

## Implementation Order (Tomorrow)

1. **Add SessionLog struct + accumulation** (30 min)
2. **Wire up onset/timing events to log** (30 min)
3. **Add export command + file storage** (20 min)
4. **Run test scenarios 1-8** (20 min)
5. **AI analysis session** (discuss findings, propose fixes)

---

## Key Insight

The current system seems to reward:
- Landing ANY hit near a beat (even if most beats are missed)
- Hitting accented beats (beat 1)

But doesn't penalize:
- Extra hits between beats (random noodling)
- Inconsistent rhythm (some hits on beat, others random)
- Short sessions with few data points getting high scores

The logging will confirm exactly which of these is the real culprit.
