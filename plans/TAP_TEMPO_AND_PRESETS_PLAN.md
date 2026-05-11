# Tap Tempo + Presets — Implementation Plan

> **Goal:** Two small, high-impact features that round out Yames' core UX.
> **Total effort:** ~2-3 days combined. Ship together in one release.
> **Delete this file after implementation.**

---

## Feature 1: Tap Tempo

### What

Tap a button (or key) at the desired tempo. BPM auto-detects from the intervals between taps. Every hardware metronome and most software metronomes have this — users expect it.

### Algorithm

Frontend-only. No Rust changes needed.

```
Rolling window of last 8 tap timestamps
  → compute average interval between consecutive taps
  → BPM = 60000 / avgInterval
  → clamp to 20-300
  → call setBpm() via existing IPC

Reset if >2s between taps (timeout)
Minimum 2 taps to produce a reading
Each new tap refines the BPM (live updates)
```

Outlier rejection: if a tap interval is >2× or <0.5× the running average, discard it (accidental double-tap or pause).

### UX Design

**Where it lives:** A small "TAP" button directly below the BPM slider, in the metronome (beat) view only. Not a separate view — it's part of the core BPM controls.

**Interaction:**

```
     ┌── ─ ── 120 ── + ──┐    BPM display
     │  ═══════●════════  │    Slider
     │      Andante       │    Tempo marking
     │                    │
     │    ┌──────────┐    │
     │    │   TAP    │    │    Tap button — click repeatedly
     │    └──────────┘    │
     │                    │
```

**States:**

1. **Idle:** Button says "TAP". Muted styling, doesn't draw attention.
2. **First tap:** Button highlights. Shows "TAP" still — waiting for more taps.
3. **Active (2+ taps):** BPM display updates live with each tap. Button pulses on each tap (subtle scale animation). A small "tap count" badge appears: "3 taps", "4 taps"... more taps = more confident reading.
4. **Committed (2s no tap):** BPM is set. Button returns to idle. Optional: brief flash/glow to confirm "BPM set to 142".

**Key behaviors:**
- Tapping while playing: BPM updates LIVE mid-playback (same as hardware metronomes). Don't stop playback.
- Tapping while stopped: Sets BPM, stays stopped.
- The BPM number in the display should animate/pulse each time it changes from a tap (same animation as when scrolling the slider, but snappier).
- Works with keyboard: `T` key triggers a tap (window-level, not global — avoid conflicts when app isn't focused).

**Floating widget:** No tap button in the widget for v1 (too small). But if `T` key is pressed while widget is focused, it should work.

**Zen/fullscreen mode:** No tap button visible — zen mode is for playing, not configuring. The `T` key still works though.

### Implementation

**New hook: `useTapTempo.ts`**

```typescript
export function useTapTempo(onBpmDetected: (bpm: number) => void) {
  const tapsRef = useRef<number[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [tapCount, setTapCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const tap = useCallback(() => {
    const now = performance.now();  // high-res timer
    const taps = tapsRef.current;

    // Reset if >2s since last tap
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      taps.length = 0;
    }

    taps.push(now);
    if (taps.length > 8) taps.shift();
    setTapCount(taps.length);
    setIsActive(true);

    if (taps.length >= 2) {
      // Compute intervals, reject outliers
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      const median = intervals.slice().sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
      const filtered = intervals.filter(iv => iv > median * 0.5 && iv < median * 2);
      if (filtered.length > 0) {
        const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
        const bpm = Math.round(60000 / avg);
        onBpmDetected(Math.max(20, Math.min(300, bpm)));
      }
    }

    // Auto-reset after 2s of no taps
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      tapsRef.current.length = 0;
      setTapCount(0);
      setIsActive(false);
    }, 2000);
  }, [onBpmDetected]);

  const reset = useCallback(() => {
    tapsRef.current.length = 0;
    setTapCount(0);
    setIsActive(false);
    clearTimeout(timeoutRef.current);
  }, []);

  return { tap, tapCount, isActive, reset };
}
```

**MainWindow changes:**
- Import `useTapTempo`
- Call `const { tap, tapCount, isActive } = useTapTempo((bpm) => setBpm(bpm))`
- Add TAP button below BPM slider in the beat view
- Add `T` keydown handler (window-level, via `useEffect` with `keydown` listener)
- Prevent `T` from triggering when an input field is focused

**CSS:**
- `.tap-btn` — pill-shaped button, accent border, muted by default
- `.tap-btn.active` — glow/pulse animation
- `.tap-count` — tiny badge showing tap count, fades in after 2nd tap

**Files changed:**
- `src/hooks/useTapTempo.ts` (new)
- `src/components/MainWindow.tsx` (add button + keyboard handler)
- `src/styles/main-window.css` (tap button styles)

**Effort: 2-3 hours**

---

## Feature 2: Presets

### What

Save named configurations (BPM, subdivision, time signature, sound, volume, and optionally a drill config) and recall them instantly. Musicians practice multiple exercises — presets let them switch context without re-dialing everything.

### UX Design

This is where UX matters most. Three competing patterns in the wild:

**Pattern A (dropdown):** Most metronome apps — a dropdown list of saved presets. Works but boring and requires mouse precision.

**Pattern B (horizontal pills):** Like browser tabs or DAW scene buttons. Quick visual scan, one-click switch. Gets crowded with many presets.

**Pattern C (command palette):** Like VS Code Cmd+P or Raycast. Type to filter, arrow keys to select. Fast for power users, bad for discovery.

**Our choice: Pattern B (pills) + long-press to manage.** Compact, visual, one-tap switching. Fits our existing tab bar aesthetic. For drills specifically, users already configure everything in DrillView — "Save as preset" is just a button there.

### Layout

A slim preset strip below the tab bar (metronome/drill/tapit tabs), above the main content. Only visible when presets exist OR when user is on beat/drill view.

```
┌──────────────────────────────────────────┐
│  ♩ Metronome    ⚡ Drill    🎯 Tap It   │  tab bar
├──────────────────────────────────────────┤
│  [Jazz 140] [Metal 16ths] [Warm-up] [+] │  preset bar
├──────────────────────────────────────────┤
│                                          │
│              120 BPM                     │  main content
│          ═══════●════════                │
│              ...                         │
```

**Preset pill states:**
- **Inactive:** Subtle outline, muted text
- **Active:** Filled with accent color, white text
- **Modified (dirty):** Active + small dot indicator (like unsaved file in VS Code)
- **Hover:** Slight highlight

**Interactions:**
- **Click pill** → load preset (applies all settings immediately)
- **[+] button** → save current settings as new preset (prompts for name via inline input)
- **Right-click pill** (or long-press on trackpad) → context menu: Rename, Update (save current settings to this preset), Delete
- **Drag pills** → reorder (nice to have, skip for v1)

**When a preset is active and user changes any setting:**
- Show the dirty dot on the pill
- No auto-save — user explicitly clicks "Update" from context menu, or the dot is just informational ("you've tweaked this")

**Keyboard shortcuts:**
- `Cmd/Ctrl + 1-9` → load preset by position (1st, 2nd, ... 9th)
- No shortcut for "save" — mouse action only, avoids accidental saves

### What's Saved in a Preset

```typescript
interface Preset {
  id: string;
  name: string;
  createdAt: number;
  // Metronome state
  bpm: number;
  subdivision: number;      // 1-6
  timeSignature: number;    // beats per bar
  soundType: string;        // "click" | "wood" | "beep" | "drum"
  volume: number;
  // Optional drill config (only if saved from drill view)
  speedRamp?: {
    startBpm: number;
    targetBpm: number;
    increment: number;
    decrement: number;
    barsPerStep: number;
    beatsPerBar: number;
    mode: string;           // "linear" | "zigzag"
    cyclic: boolean;
    warmupBeats: number;
  };
  // Which view was active when saved
  view: "beat" | "drill";
}
```

**NOT saved** (app-level prefs, not musical context):
- Theme, widget mode, corner, always-on-top, window position

### Storage

Presets stored via existing `tauri-plugin-store` in the app's settings directory. Keep it simple — a `presets` key in the existing settings store.

```json
{
  "presets": [...],
  "activePresetId": "abc123" | null
}
```

### Default Presets

Ship 3 built-in presets so users see the feature immediately and understand the pattern:

| Name | BPM | Sub | Time Sig | Sound |
|------|-----|-----|----------|-------|
| Simple Click | 100 | Quarter | 4/4 | Click |
| Swing Practice | 140 | Triplet | 4/4 | Wood |
| Speed Drill | — | Quarter | 4/4 | Click |

The Speed Drill preset includes a speed ramp config (80→160, +5, 4 bars per step, linear).

These defaults are injected on first launch (if no presets exist). Users can delete them.

### Implementation

**Rust side:**

New commands in `commands.rs`:

```rust
#[tauri::command]
fn list_presets(store: State<StoreHandle>) -> Vec<Preset> { ... }

#[tauri::command]
fn save_preset(store: State<StoreHandle>, preset: Preset) -> Result<()> { ... }

#[tauri::command]
fn delete_preset(store: State<StoreHandle>, id: String) -> Result<()> { ... }

#[tauri::command]
fn reorder_presets(store: State<StoreHandle>, ids: Vec<String>) -> Result<()> { ... }
```

`load_preset` is NOT a Rust command — it's frontend-only. The frontend reads the preset data and calls the existing `setBpm`, `setSubdivision`, `setTimeSignature`, etc. commands. This keeps it simple and reuses all existing state management.

**Frontend side:**

New component: `PresetBar.tsx`
- Renders the preset pills
- Handles click (load), right-click (context menu), [+] (save dialog)
- Tracks `activePresetId` and `isDirty` state

New IPC wrappers in `ipc.ts`:
- `listPresets()`, `savePreset(preset)`, `deletePreset(id)`, `reorderPresets(ids)`

Integration in `MainWindow.tsx`:
- Render `<PresetBar />` below the tab bar
- On preset load: call `setBpm`, `setSubdivision`, `setSoundType`, `setVolume`, `setTimeSignature` in sequence
- If preset has `speedRamp`: switch to drill view + call `configureSpeedRamp`
- Track `activePresetId` in MainWindow state + detect dirty state by comparing current state to loaded preset

**CSS:**
- `.preset-bar` — horizontal flex strip, scrollable if too many presets
- `.preset-pill` — rounded pill, transitions
- `.preset-pill.active` — accent fill
- `.preset-pill.dirty::after` — small dot indicator
- `.preset-add-btn` — the [+] button
- `.preset-name-input` — inline text input for naming (appears in-place of the [+] when creating)

**Save flow:**
1. User clicks [+]
2. [+] button transforms into a text input with auto-focus
3. User types name, presses Enter
4. Preset saved, pill appears, input collapses back to [+]
5. If user presses Escape or clicks away, cancel

**Files changed:**
- `src-tauri/src/commands.rs` (3-4 new commands)
- `src/ipc.ts` (new IPC wrappers)
- `src/components/PresetBar.tsx` (new component)
- `src/components/MainWindow.tsx` (integrate PresetBar, load logic, keyboard shortcuts)
- `src/styles/main-window.css` (preset bar styles)
- `src/types.ts` (Preset type)

**Effort: 1.5-2 days**

---

## Implementation Order

1. **Tap Tempo first** (smaller, self-contained, unblocks "tap tempo" SEO claim)
   - `useTapTempo.ts` hook
   - TAP button in MainWindow beat view
   - `T` keyboard shortcut
   - CSS

2. **Presets second** (builds on existing IPC patterns)
   - Rust: Preset struct + store commands
   - `PresetBar.tsx` component
   - MainWindow integration + keyboard shortcuts
   - Default presets
   - CSS

3. **Test together**, commit, release

---

## Open Decisions

| Question | Recommendation |
|----------|---------------|
| Should tap tempo work in drill view? | No — drill has its own BPM management via the ramp. Tap tempo is metronome-only. |
| Should loading a drill preset auto-start the drill? | No — just configure. User presses play when ready. |
| Max number of presets? | 20 is plenty. Show a "max reached" toast if exceeded. |
| Should presets sync across devices? | No. Local only. No cloud, no sync. Consistent with privacy stance. |
| Where to show preset bar in DrillView? | Same position (below tabs). When loading a drill preset, the pill stays active. When user changes drill config, it goes dirty. |
| Context menu implementation? | Simple custom dropdown on right-click. No native context menu (Tauri webview limitation). |
