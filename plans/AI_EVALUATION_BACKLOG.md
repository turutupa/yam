# AI-Augmented Playing Evaluation — Future Backlog

> **Status:** Backlog. Not committed for v1.
> **Prerequisite:** `PLAYING_EVALUATION_PLAN.md` (DSP-only foundation) must ship first.

This document captures AI/ML ideas that could enhance Yames' playing analysis after the DSP foundation is in place. Each item should only be pursued if (a) DSP can't solve it well, and (b) there's clear user demand.

---

## Why This Is Backlog, Not v1

DSP gives us deterministic, fast, lightweight, privacy-pure analysis for **timing, dynamics, and basic clarity**. AI adds value only for **subjective qualities** that can't be reduced to clean signal-processing metrics. The cost of adding AI (model files, GPU dependencies, complexity, retraining, hardware compatibility matrix) is high, so each AI feature must clear a high bar.

**Default position:** "Can DSP do this in 80% as good a way?" If yes, ship that. AI only when DSP genuinely cannot deliver.

---

## Backlog Items

### B1 — Technique Classification

**What:** Classify each onset's playing technique: alternate picking, sweep picking, hammer-on, pull-off, tapping, slap, pop, finger style, plectrum, etc.

**Why DSP can't do it well:** Spectral signatures of these techniques overlap heavily and depend on the instrument, gain settings, EQ, and player. Hand-crafted features get to ~60-70% accuracy at best.

**AI approach:** Small CNN (~1-2 MB) on log-mel spectrograms of 100ms windows around each onset. Trained on labeled audio per instrument family.

**Cost:**
- Need training data (significant effort to collect or license)
- ~10-30MB per instrument family of trained model files
- ~5-15ms inference per onset on CPU
- Cross-platform inference: `tract` (pure Rust) or `ort` (ONNX Runtime, has C deps)

**Value:** Niche. Most users don't need this. But could power "you're alternate picking inconsistently — try down-up only for this exercise" feedback.

**Verdict:** Backlog. Maybe Phase 7+.

---

### B2 — Subjective Feel / Groove Scoring

**What:** Rate the "feel" of a phrase — does it groove? Does the swing feel right? Is it expressive vs robotic?

**Why DSP can't do it well:** "Feel" is an emergent quality from timing micro-variations, dynamics, and articulation. Quantifying it is hard.

**AI approach:** A model trained on professionally-graded playing samples (would need to acquire dataset). Could be a regression model outputting a scalar "groove score."

**Cost:**
- Massive dataset acquisition challenge
- Subjective ground truth (different graders disagree)
- Model size, inference cost
- Risk of opinionated/wrong outputs annoying users

**Value:** Could be cool but very risky. Easy to be wrong in ways that frustrate users.

**Verdict:** Backlog. Probably never ship. Better as a YouTube content idea than a product feature.

---

### B3 — Multi-Drum Classification

**What:** When a drummer plays, identify which drum was hit (kick, snare, hi-hat, ride, crash, tom1-3) for each onset.

**Why DSP can be partial:** Spectral centroid + bandwidth gets you 70-80% accuracy on a typical kit. Confusion between toms and between cymbals is hard.

**AI approach:** Small CNN on spectrograms, trained per kit (or with kit-detection preprocessing).

**Cost:**
- Smaller scope (just drums)
- Reasonable training data exists (drum samples libraries)
- ~5-10MB model
- ~5ms inference per onset

**Value:** Drummers are an underserved metronome user base. Per-drum feedback ("your snare timing is great but kick is dragging") would be unique.

**Verdict:** Strong backlog candidate. Worth pursuing once DSP foundation is solid and we have drummer users asking for it.

---

### B4 — Natural Language Coach (Local LLM)

**What:** After a session, the LLM reads the structured `SessionReport` and generates 2-3 sentences of natural-language coaching: *"You started strong but consistency degraded above 140 BPM — your ring finger seems to be dragging on the eighth notes between beats 2 and 3. Try slowing down to 120 and isolating just that fragment."*

**Why DSP can't do it well:** Natural language synthesis from structured data is what LLMs are for. Templated phrases work but feel robotic.

**AI approach:** Small quantized local model (Qwen2.5-1.5B-Instruct Q4 = ~1GB, or Llama-3.2-1B Q4 = ~700MB) via `llama-cpp-2` Rust bindings. Use Metal/CUDA acceleration where available.

**Cost:**
- ~700MB-1GB model download (huge)
- 100ms-1s per generation (acceptable for post-session, not for real-time)
- GPU strongly recommended (CPU works but slow)
- Cross-platform GPU support is fiddly

**Value:** Adds polish and personality. Differentiates from "your stats" toward "your coach." Could justify a paid Pro tier.

**Verdict:** Strong backlog candidate. Make it strictly opt-in. Download model on first use. Clearly labeled as experimental + GPU-accelerated.

**Important:** All inference local. NEVER send session data or audio to cloud APIs.

---

### B5 — Note Pitch / Interval Detection

**What:** Identify the actual notes being played (C, E, G7 chord, etc.) and detect mistakes vs intended notes.

**Why DSP can be partial:** Pitch detection (YIN, autocorrelation) is well-solved for monophonic. Polyphonic transcription (chords) is much harder.

**AI approach:** Polyphonic transcription models exist (Magenta's MT3, BasicPitch by Spotify). Could integrate BasicPitch (~30MB ONNX model).

**Cost:**
- BasicPitch is open source, MIT licensed
- ~30MB model
- ~50-100ms per note
- Useful for many instruments

**Value:** Opens up "play these specific notes along with the metronome" exercises. Bigger feature, basically a whole new mode.

**Verdict:** Backlog. Different feature scope. Could be its own app section ("Exercises") rather than metronome enhancement.

---

### B6 — Custom Sound Removal (Click Cancellation)

**What:** Surgically remove the metronome click from the input audio so only the user's playing remains.

**Why DSP can do most of it:** Phase cancellation works perfectly when we know the exact click waveform AND the system latency. We have both. Should be near-trivial DSP.

**AI approach:** Source separation (Demucs, Spleeter). Massive overkill for a known-signal problem.

**Verdict:** **Skip AI entirely.** Pure DSP solves this. Listed here only to document the rejection.

---

### B7 — Adaptive Difficulty / Practice Recommendations

**What:** Watch a user's history and intelligently suggest the next drill: "Your timing at 130 BPM is now solid. Ready to try 140?"

**Why DSP can do most of it:** Statistical analysis of session history can drive most recommendations: track personal bests per BPM, detect plateaus, suggest harder exercises when consistency exceeds threshold.

**AI approach:** A reinforcement-learning-style recommender. Probably overkill — heuristics work fine here.

**Verdict:** Backlog as a heuristic feature, not AI. List here only to document the rejection.

---

### B8 — Voice / Singing Analysis

**What:** Pitch accuracy + timing for vocalists.

**Why DSP can do timing:** Same as instruments.
**Why DSP can do pitch:** Excellent monophonic pitch trackers exist.
**Why AI might help:** Vibrato analysis, breath detection, vocal fry classification, etc.

**Verdict:** Backlog. Big scope. Different audience. Could spin off as a sister product.

---

## Cross-Cutting Concerns for AI Features

### Inference Runtime
- **`tract`** (Rust): pure Rust, supports ONNX, no GPU. Best for small models, max compatibility.
- **`ort`** (ONNX Runtime via Rust bindings): C++ backend, GPU support (CoreML on Mac, CUDA on Windows/Linux), wider model support. Adds C dependency.
- **`llama-cpp-2`** (LLM-specific): GGUF models, Metal/CUDA/Vulkan GPU support, pure Rust bindings around C++ core.
- **`candle`** (Hugging Face): pure Rust, GPU via Metal/CUDA, growing model support.

**Recommendation per use case:**
- Small CNN classifiers (B1, B3): `tract` for portability, fall back to `candle` if GPU needed.
- LLM coach (B4): `llama-cpp-2`. It's the standard for local LLM inference and well-maintained.

### Model Distribution
- **Don't bundle models in the installer.** Bloats download from ~10MB to gigabytes.
- **Download on first use** with progress bar and clear "this is X MB" disclosure.
- **Quantize aggressively** — Q4 GGUF for LLMs, INT8 for CNNs.
- **Cache locally** in `~/Library/Application Support/com.yames.metronome/models/` (or platform equivalent).
- **Versioning** — store model hash, support upgrade prompts.
- **Privacy** — model files are static binaries. They contain no user data. Safe to share between users / cache.

### Privacy
All AI inference must remain 100% local. Same standard as DSP. **No cloud APIs. No telemetry. Ever.**

The privacy story is the moat. Don't compromise it for AI features.

### Performance
AI features should be **opt-in per feature**, with a clear toggle in `Settings → Experiments`. Always show CPU/GPU usage warnings. Consider a global "Pause all AI features" master switch when on battery power.

### Failure Modes
- Model file corrupted or missing → fall back to DSP-only feedback gracefully
- Inference fails or times out → drop the AI insight, keep the DSP report
- GPU not available → CPU inference (slower but works) with warning

---

## Roadmap Order (If We Pursue Any Of These)

If user demand justifies AI features, recommended order:

1. **B6 reject** (do click cancellation in DSP, easy win) — **immediate**
2. **B4 LLM Coach** (most user-visible polish) — biggest "wow" factor for marketing
3. **B3 Drum Classification** (underserved drummer audience) — niche but unique
4. **B5 Pitch Detection** (opens new mode: scale/exercise practice) — bigger feature, different scope
5. **B1 Technique Classification** (advanced players only) — narrow audience
6. **B8 Voice/Singing** (consider as sister product) — separate product
7. **B2 Subjective Feel** (probably never) — too risky

---

## Alternative: Stay DSP-Forever

A genuinely valid product strategy is to **never add AI** and double down on:
- Best-in-class DSP precision
- Best-in-class privacy story
- Best-in-class musician UX

"The metronome that respects your CPU and your privacy" might be a stronger positioning than "a metronome with an AI coach." Worth considering as the long-term identity of the product.
