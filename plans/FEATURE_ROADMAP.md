# Yames Feature Roadmap

> Prioritized by user value (ROI). Effort is not factored in — this is a wish list ordered by impact.
> Items with a `[PLAN]` tag have a detailed implementation plan in this folder.
> Remove items from this list once they ship. Delete their implementation plans too — the code is the source of truth.

---

## Shipped

- ~~Playing Evaluation / Rhythm Accuracy Feedback~~ → `PLAYING_EVALUATION_PLAN.md` (Phases 1-7 done)
- ~~Practice Coach (session lifecycle, card UI, template + LLM coaching, TTS, chat)~~ → `PRACTICE_COACH_UX_PLAN.md`
- ~~Setlist / Preset Manager~~ → Presets with save/load/reorder, session history per preset
- ~~Sound Customization~~ → Click, wood, beep, drum
- ~~Speed Trainer / Adaptive Drill~~ → Linear, zigzag, adaptive modes with model-driven tempo

---

## Active

### 1. DSP Accuracy & Coach Intelligence `[PLAN]`
Polish the DSP scoring pipeline (diagnostic logging, formula overhaul, onset detection improvements) and make the coach contextually smart (history-aware greetings, preset awareness, recurring issue detection).

**Plan:** `DSP_AND_COACH_INTELLIGENCE_PLAN.md`

---

## Backlog

### 2. Accent Patterns / Custom Beat Emphasis `[PLAN]`
Configure which beats get accented (e.g., strong on 1 and 3, ghost on the "and"s). Critical for genre-specific practice.

**Plan:** `ACCENT_PATTERN_PLAN.md`

### 3. Odd Time Signatures & Polyrhythms
5/4, 7/8, 3 against 4, etc. Table stakes for serious musicians and a common reason people look beyond basic metronomes.

### 4. Subdivisions with Swing / Shuffle Feel
Adjustable swing percentage (50% straight to 67% triplet swing). Jazz, blues, funk players need this constantly.

### 5. Import / Sync with Sheet Music or Setlist Apps
Read BPM/time sig from a file, integrate with apps like OnSong or forScore. Bridges the gap between practice and performance.

### 6. Multi-Device Sync
Two musicians in a room, both running Yames, locked to the same tempo. Also useful for online jam sessions.

---

## Mobile `[PLAN]`
Not ranked above because it's a platform expansion, not a feature — but high impact.

**Plan:** `MOBILE_IMPLEMENTATION_PLAN.md`
