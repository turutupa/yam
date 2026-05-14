# Practice Coach — UX & Architecture Plan

> This plan captures the full user experience vision for the Practice Coach feature.
> The UX details here are the source of truth — implementation details are secondary
> and should be derived from these decisions.

---

## Philosophy

The app should be beautiful and aesthetically pleasing to attract users, but once they
are playing, it fades into the background. Users should not need to look at the screen
while playing. The coach communicates through audio, not visuals. Hands stay on the
instrument at all times.

This is why footswitch hotkeys exist, why zen mode exists, and why the coach uses
audio notifications — everything serves the principle of **eyes on instrument, ears on
music, screen is secondary**.

---

## 1. Session Lifecycle

### What a session is
A session is an intentional practice container. It is NOT "press play, press stop."
The user explicitly starts a session and explicitly ends it. Within a session, they can
play/stop the metronome multiple times, switch between metronome and drill views,
change BPM, change presets — all within the same session.

### Starting a session
- User taps the microphone button (currently labeled "Practice coach")
- Button changes to active/glowing state
- Coach card opens on the right side
- First message in the feed: "Session started" (or a model-generated greeting if a
  preset is loaded, e.g., "Welcome back to Spider Exercise — last time you topped out
  at 132 BPM with solid accuracy. Ready to push further?")

### Ending a session
- Same microphone button toggles off (tap to start, tap to end)
- Additionally, an "End Session" button should be available inside the coach card for
  explicit clarity
- On end: full session report is generated and displayed in the coach card
- If a preset is active, the session is auto-saved to that preset's history

### Unified across views
The session spans metronome and drill modes. If the user starts in metronome at
120 BPM, switches to drill with a speed ramp, then goes back to metronome — it's
all one session. The coach observes everything continuously.

---

## 2. Coach Card Design

### Layout
- Floating tiled card on the right side of the main window
- Spans from below the top navbar to the bottom edge
- Extends to the right edge
- Has a gap/margin from the main content and edges (like window tiling managers)
- Pushes main content to the left when open (does not overlay)
- Theme-aware — follows the app's current theme colors

### Structure
- Chronological chat-like feed (top to bottom, newest at bottom)
- Contains: coach comments, mini-reports on pause, end-of-session report
- Chat input always visible at the bottom for user questions
- Collapsible — user can close/minimize the card at any time
- Coach continues running in background when collapsed

### Coexistence with other UI
- Preset sidebar is on the LEFT side — no conflict
- Coach card is on the RIGHT side
- Both can be open simultaneously

---

## 3. Feedback During Playing

### Core principle
The user is NOT looking at the screen while playing. All feedback during active
playing is delivered through audio.

### Audio notification system
Three user-selectable modes (in settings):

| Mode | Behavior |
|---|---|
| Silent | Comments appear in chat feed only, no audio interruption |
| Chime | App audio dims briefly + subtle notification sound, comment in feed |
| Voice | App audio dims briefly + TTS reads the comment aloud, comment in feed |

### Notification urgency tiers
The model (or DSP heuristics) decides the urgency of each comment:

- **Urgent** (triggers audio notification): tempo drifting significantly, consistent
  worsening problem over multiple bars, major achievement worth celebrating
  (e.g., "30 bars clean — personal best")
- **Normal** (appears in feed silently): minor observations, tips, gentle notes.
  User sees them on next pause or after session.
- The model decides the tier along with the comment content.

### What the coach comments on during playing
- Tempo drift ("you're gradually speeding up")
- Consistent timing issues ("beat 3 is consistently early")
- Positive reinforcement ("great consistency on that run")
- Dynamic/accent issues ("accents aren't coming through clearly")
- Distortion/noise issues ("lots of bleed in the signal")
- The coach should be conservative — commenting too often is annoying.
  Think "meaningful trend over 4+ bars" not "per-bar critique."

### User control
- Users can opt out of audio notifications entirely (silent mode)
- Notification level setting: All feedback / Important only / Silent
- These are independent of the voice/chime/silent delivery mode

---

## 4. Feedback On Pause (Mini-Reports)

### When to inject a mini-report
When the DSP detects:
- Player was playing for at least ~15-20 seconds of meaningful playing
- Player has stopped for ~3-5 seconds
- There is something worth reporting

If the player only played for a few seconds and stopped, that's likely a false start,
tuning, or adjustment — don't comment.

### What the mini-report contains
A concise summary of the passage just played, injected as a coach message in the
chat feed. Examples:
- "That run was clean — beat 3 is still a hair early. Consistency improved from
  your last round though."
- "Tempo stability was great. You're sitting slightly behind the beat — consistent
  pocket though."

### No notification needed
The user stopped playing and is probably looking at the screen. The mini-report
just appears in the feed — no chime or voice needed.

---

## 5. End-of-Session Report

### Timeline-based structure
The report is NOT a single aggregate of the whole session. It's a timeline showing
segments of what happened:

```
0:00–3:12 — Grid exercise, 120 BPM — accuracy 91%, slight rushing on beat 3
3:30–8:45 — Free playing, 120 BPM — tempo stability 94%, great pocket consistency
8:50–12:00 — Drill, Linear 100→140 BPM — clean up to 125, struggled above 130
```

The DSP naturally segments these based on when playing style or settings change.

### Adaptive stats per segment
Each segment shows stats relevant to what was actually played in that segment:

**For grid-aligned playing (exercises):**
- Grid accuracy breakdown (perfect / good / ok / miss)
- Per-beat analysis
- Timing distribution
- Streaks
- Label it clearly as "Grid accuracy" or "Subdivision accuracy"

**For free/musical playing (licks, improvising, songs):**
- Tempo stability over time
- Pocket tendency (ahead / behind / centered)
- Consistency score
- Dynamic range

**The score/rating** at the top comes from different ingredients depending on the
segment type. Grid segments weight accuracy. Free segments weight stability +
consistency.

### Model-generated summary
At the top or bottom of the report, the model generates a natural language summary
of the entire session, connecting the dots across segments.

### Auto-save
If a preset is active, the session is automatically saved to that preset's history.

---

## 6. Playing Style Detection

### The approach: correlation, not classification
Do NOT classify playing into discrete categories (exercise vs lick vs improvising).
Instead, measure **grid correlation** as a continuous score:

- What percentage of detected onsets land near subdivision grid points?
- 95% → high grid correlation → this is an exercise → show grid stats
- 40% → medium → some structure but not strict → blend stats
- 10% → low → improvising freely → show pulse/consistency stats only

### Why this works
- No user input needed — detection is automatic
- Handles transitions mid-session (exercise → improvising) naturally
- The correlation score shifts in real time
- Avoids the impossible task of "understanding music" — the DSP just measures
  how well onsets align with the grid

### What's always measurable (any playing style)
These metrics are universally valid regardless of what the user is playing:
- Are they staying with the tempo?
- Are they drifting over time?
- Are they consistent bar to bar?
- Are their dynamics intentional (clear accent patterns vs flat/random velocity)?

### What's only measurable with high grid correlation
- Per-beat accuracy (perfect / good / ok / miss)
- Specific beat analysis ("beat 3 is rushing")
- Streaks

### The model's role
The DSP produces structured data. The model translates it into natural language
appropriate for the detected playing style. The model never analyzes audio — it
only interprets DSP metrics.

---

## 7. Chat / Q&A

### Always available
The chat input at the bottom of the coach card is always active during and after
a session. Users can ask questions at any time.

### Intended use
- "How was my timing on that last run?"
- "What should I focus on?"
- "Am I improving compared to last session?"
- Questions scoped to the session and practice — not general music theory

### Practical consideration
If the user types during playing, they've already put down their instrument — this
is self-regulating. No need to gate or restrict when they can type.

### Context the model receives for Q&A
- Current session DSP data (all segments)
- Preset history summary (if a preset is active)
- The conversation so far in the feed
- The model is constrained via system prompt: only discuss this session, only
  reference data it's been given, keep responses short and coaching-focused.

---

## 8. Adaptive Drill Mode

### What it is
A new drill strategy alongside Linear and Zigzag. The app controls BPM changes
based on how the user is performing. Independent from the coach — adaptive mode
works with or without the coach enabled.

### User configuration
- **Base BPM**: starting tempo
- **Target BPM**: goal tempo (or "No ceiling" — keep going until the user stops)
- **Aggressiveness**: Conservative / Moderate / Aggressive

The user does NOT set step BPM. The whole point is that the algorithm decides steps.

**No ceiling mode**: No target BPM. The adaptive algorithm just keeps pushing up
as long as accuracy holds. The coach (if active) can comment on milestones:
"You just broke 160 — new territory." This is essentially a "see how fast you can
get" challenge mode.

### Aggressiveness levels

| Level | Step size | Bars needed to step up | Back-off sensitivity |
|---|---|---|---|
| Conservative | 2-3 BPM | More bars of good accuracy | Backs off quickly |
| Moderate | ~5 BPM | Balanced | Balanced |
| Aggressive | 5-10 BPM | Fewer bars needed | Only backs off on significant accuracy drop |

### How it works
- DSP measures accuracy in real time
- Accuracy above threshold for N bars → step up
- Accuracy below threshold for N bars → step down
- The aggressiveness setting controls the thresholds and step sizes
- If the coach is active, it may comment on adaptive decisions:
  "Bumped you to 125 — you handled that well" or "Brought it down to 115,
  let's lock this in before pushing further"

### Naming
Call it **Adaptive** — clear, no ambiguity.

---

## 9. Presets & Session History

### Preset = exercise identity
A preset defines what you're practicing. Sessions are tagged with the active preset.
This enables progress tracking over time.

### Session history per preset
- Each completed session is saved with its report data
- Users can view history for a given preset and see improvement over time
- Example: "Spider Exercise — 23 sessions over 6 weeks, comfortable BPM
  increased from 100 to 135"

### Compacted history for the model
Raw session reports are too large to feed into the model. Instead, maintain a
**preset summary** that gets updated after each session:

```
Preset: Spider Exercise
Sessions: 23 over 6 weeks
Best accuracy: 94% at 120 BPM
Comfortable BPM: 130 (>85% accuracy consistently)
Max attempted: 155 BPM
Trend: steady improvement, +5 BPM comfortable range per week
Recurring issue: beat 3 rushing at tempos above 140
Last session: 2 days ago, 88% at 135 BPM
```

This is tiny and fits easily in the model's context. It enables the model to give
context-aware comments:
- "You've been stuck around 135 for the last few sessions — let's try focusing
  on that beat 3 issue, it might be the bottleneck."
- "Your consistency at 120 has gotten really solid. Time to push to 125?"

### When no preset is active
Sessions are still saved to a general history, but without preset tagging. The model
has less historical context but can still reference the current session and recent
general sessions.

---

## 10. Zen Mode Integration

### Zen mode stays pure
No coach UI in zen mode. No floating comments, no overlays. Zen is zen.

### Coach runs in background
If a session is active and the user enters zen mode, the coach continues:
- DSP keeps analyzing
- Coach comments accumulate in the feed
- Audio notifications still work (chime/voice) based on user settings
- When the user exits zen mode, the full feed is waiting for them

This is the best of both worlds — undistracted playing with full feedback available
on demand.

---

## 11. Tech Stack

### Brain (language model for coach intelligence)
Two tiers offered to the user:

| Tier | Model class | Size | Capability |
|---|---|---|---|
| Standard | Qwen2.5-1.5B Q4 (or equivalent) | ~900MB | Good comments, solid Q&A, reliable timing decisions |
| Full | Phi-3.5-mini Q4 (or equivalent) | ~2GB | Best quality, most nuanced, strongest Q&A |

Note: specific models may change as the landscape evolves. The tier sizes and
capability expectations are what matter.

### Voice (TTS for spoken feedback)
- **Engine**: Piper TTS (~50-80MB per voice, ONNX runtime)
- **Voices**: 2-3 options with different personalities (e.g., calm/warm, direct,
  neutral)
- **Quality target**: natural audiobook narrator level — not robotic, not trying
  to be indistinguishable from human. Needs to sound like a competent coach
  giving brief notes.

### Download experience
- User selects a brain tier in Settings → Smart Coach
- Single download includes brain model + all voice models (~180MB for 3 voices)
- One progress bar, one action
- Coach features unlock immediately after download
- Voice selection is a separate setting (available after download)

### Settings page layout

**Smart Coach section:**

**Brain**
- Off (no coach)
- Standard (~900MB) — recommended
- Full (~2GB) — best quality

Selecting a tier triggers: "Download Standard coach? (~1.1GB including voices)"

**Voice** (visible after brain download)
- Silent — chat feed only
- Chime — notification sound + feed
- Voice: [Name 1] / [Name 2] / [Name 3]

**Notification level**
- All feedback
- Important only
- Silent (read later)

### Architecture: DSP is the brain, model is the voice
The model does NOT analyze audio or understand music. The DSP does all analysis
and produces structured metrics. The model's job is:
1. Translate structured DSP data into natural, human-sounding coaching comments
2. Decide when something is worth commenting on (and at what urgency)
3. Answer user questions about their session by interpreting DSP data
4. Generate session summaries and reports

This separation keeps model requirements light — it's a translator with personality,
not an audio analysis engine.

---

## 12. Implementation Sequencing & Success Criteria

Each phase has concrete success criteria so completion is verifiable.

### Phase 1: Session lifecycle & coach card UI
The container for everything.

**Success criteria:**
- [ ] Microphone button toggles session on/off
- [ ] Coach card opens on session start, floating tiled layout on the right
- [ ] Card pushes main content left (does not overlay)
- [ ] Card is collapsible and re-openable during a session
- [ ] Card follows active theme colors
- [ ] "Session started" message appears in feed on start
- [ ] "End Session" button inside the card works
- [ ] Session persists across play/stop cycles and view switches (metronome ↔ drill)
- [ ] Chat input visible at bottom of card (non-functional placeholder OK for now)

### Phase 2: DSP evaluation with grid correlation detection
The analytical brain. (See also DSP_EVALUATION_PLAN.md)

**Success criteria:**
- [ ] DSP detects onsets from audio input with timestamps and velocities
- [ ] Grid correlation score is computed continuously (0-100%)
- [ ] High correlation (>80%): per-beat accuracy metrics generated (perfect/good/ok/miss)
- [ ] Low correlation (<30%): pulse/tempo/consistency metrics generated instead
- [ ] Medium correlation: blended metrics
- [ ] Tempo drift detection works (reports gradual speeding up or slowing down)
- [ ] Pocket feel detection works (reports ahead/behind/centered tendency)
- [ ] Detection adapts in real time when playing style changes mid-session

### Phase 3: Mini-reports on pause & end-of-session timeline report
Template-based first, model-generated later.

**Success criteria:**
- [ ] Silence detection: DSP identifies when player stops after 15+ seconds of playing
- [ ] Mini-report injected into coach feed after ~3-5 seconds of silence
- [ ] Mini-report content adapts based on grid correlation of the passage just played
- [ ] No mini-report for very short playing bursts (<15 seconds)
- [ ] End-of-session report shows timeline with segments (not a single aggregate)
- [ ] Each segment shows appropriate stats for its detected playing style
- [ ] Overall session score computed with per-segment weighting
- [ ] Report displays inside the coach card feed
- [ ] If a preset is active, session auto-saves to preset history

### Phase 4: Model integration
Download management, inference pipeline, system prompt.

**Success criteria:**
- [ ] Settings page shows Smart Coach section with brain tier selection (Standard / Full)
- [ ] Selecting a tier triggers a single download (brain + voices) with progress indicator
- [ ] Download can be cancelled and resumed
- [ ] Model loads and runs inference locally — no network required after download
- [ ] Model generates natural coaching comments from structured DSP data
- [ ] Model decides when to comment and at what urgency tier (urgent vs normal)
- [ ] Model-generated comments replace template-based comments in the feed
- [ ] Model generates end-of-session summary from timeline data
- [ ] If a preset is active, model receives compacted preset history as context
- [ ] System prompt constrains model to session-scoped coaching only

### Phase 5: TTS integration
Piper setup, voice selection, audio notification system.

**Success criteria:**
- [ ] Piper TTS runs locally, produces natural speech from short text
- [ ] 2-3 voice options available in settings
- [ ] Voice setting in Settings: Silent / Chime / Voice: [Name]
- [ ] Notification level setting: All feedback / Important only / Silent
- [ ] Chime mode: app audio dims briefly, notification sound plays, comment in feed
- [ ] Voice mode: app audio dims briefly, TTS reads comment aloud, comment in feed
- [ ] Audio notifications only fire for urgent-tier comments (when "Important only" is set)
- [ ] User can switch between modes at any time, including mid-session

### Phase 6: Adaptive drill mode
DSP-driven tempo adjustment.

**Success criteria:**
- [ ] "Adaptive" appears as a drill strategy alongside Linear and Zigzag
- [ ] User configures: base BPM, target BPM (or "No ceiling"), aggressiveness
- [ ] Conservative/Moderate/Aggressive produce noticeably different behaviors
- [ ] BPM increases when accuracy stays above threshold for N bars
- [ ] BPM decreases when accuracy drops below threshold for N bars
- [ ] No ceiling mode: BPM keeps increasing as long as accuracy holds
- [ ] Adaptive works independently of coach (coach not required)
- [ ] If coach is active, it comments on adaptive tempo changes

### Phase 7: Preset history & compacted summaries
Progress tracking over time.

**Success criteria:**
- [ ] Each session saved with preset ID, timestamp, BPM, report data
- [ ] User can view session history for a given preset
- [ ] History shows improvement trends (accuracy over time, comfortable BPM over time)
- [ ] Compacted preset summary auto-generated and updated after each session
- [ ] Model receives compacted summary (not raw history) for context-aware comments
- [ ] Coach greeting on session start references preset history when available

### Phase 8: Chat Q&A
Model-powered conversation about session data.

**Success criteria:**
- [ ] Chat input in coach card sends user message to model
- [ ] Model receives: current session DSP data, preset history summary, conversation so far
- [ ] Model answers questions about the session accurately ("how was my timing?")
- [ ] Model stays scoped — doesn't answer unrelated questions
- [ ] Responses are concise (2-3 sentences typical)
- [ ] Chat works during pauses and after session end

---

## Open Questions for Future Refinement

- What specific Piper voices to ship? Needs testing for "coach personality" fit.
- Exact thresholds for grid correlation score transitions — needs empirical tuning
  with real playing data.
- How to handle very short sessions (< 30 seconds) — skip report? Minimal report?
- Should the adaptive drill have a "freeplay" option with no target BPM? (Yes —
  confirmed. "No ceiling" mode: just keep going up until the user can't keep up.
  See how fast you can get.)
