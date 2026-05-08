# Tap Tempo Plan

## Motivation

Tap tempo is a fundamental metronome UX pattern: the musician taps a button (or key) at the desired tempo and the app detects the BPM from the interval between taps. Every hardware metronome has it. Yames has "Tap It" (rhythm accuracy game) but no classic "tap to set BPM" feature.

## Current State

- **Tap It** (TrackView.tsx): Measures how accurately you tap along with the metronome. Scoring/accuracy mode. Does NOT set BPM.
- **Missing**: A way to tap 3-4 times and have BPM auto-detected from the intervals.

## Behavior Spec

### Algorithm

```typescript
// Keep timestamps of last N taps (rolling window)
const MAX_TAPS = 8;
const TIMEOUT_MS = 2000; // reset if >2s between taps

function processTap(timestamps: number[]): number | null {
  if (timestamps.length < 2) return null;
  
  // Average interval between consecutive taps
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60000 / avgInterval);
  return Math.max(20, Math.min(300, bpm)); // clamp to valid range
}
```

### UX Flow

1. User taps a button (or presses a key) repeatedly at desired tempo
2. After 2+ taps, display detected BPM in real-time (updates with each tap)
3. After 2 seconds of no taps, "commit" the detected BPM (set it as active BPM)
4. Optional: show a "confidence" indicator — more taps = more stable reading

### Where It Lives

**Option A: Dedicated button in Metronome tab** (recommended)
- A "Tap" button next to or below the BPM display
- Click/tap repeatedly → BPM updates live
- Visual feedback: button pulses on tap, BPM number shows detected value

**Option B: Keyboard shortcut only**
- e.g. `T` key triggers tap tempo
- Less discoverable but faster for power users

**Recommendation**: Both. Button in UI + keyboard shortcut.

### Integration Points

| Trigger | Location |
|---------|----------|
| Button click | Metronome tab, near BPM display |
| Keyboard `T` | Global shortcut (via existing Tauri shortcuts) |
| MIDI CC/Note (future) | Via MIDI binding → "tap_tempo" action |
| Gamepad button (future) | Via existing gamepad hook |

## Implementation

### Frontend-only approach (recommended)

Tap tempo is purely a BPM detection UI — no Rust changes needed:

```typescript
// In MainWindow.tsx or a new useTapTempo hook
function useTapTempo(onBpmDetected: (bpm: number) => void) {
  const tapsRef = useRef<number[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const tap = useCallback(() => {
    const now = Date.now();
    const taps = tapsRef.current;
    
    // Reset if too long since last tap
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      taps.length = 0;
    }
    
    taps.push(now);
    if (taps.length > 8) taps.shift(); // rolling window
    
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      onBpmDetected(Math.max(20, Math.min(300, bpm)));
    }
    
    // Auto-commit after 2s silence
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => { taps.length = 0; }, 2000);
  }, [onBpmDetected]);

  return { tap };
}
```

Then call `setBpm(detectedBpm)` via existing IPC on each detection update.

### Keyboard shortcut

Add `T` to the global shortcuts registered in `lib.rs`:
- Only active when metronome isn't in "Tap It" mode (avoid conflict)
- Or better: register `T` as non-global (window-level) shortcut in the frontend

## UI Mockup

```
┌─────────────────────────────┐
│         ♩ = 142             │ ← BPM display (pulses when tapping)
│        [  TAP  ]            │ ← Tap button (shows "3 taps" count)
│   ─────────────────────     │
│   ◆ ◇ ◇ ◇  subdivision     │
└─────────────────────────────┘
```

While tapping, the BPM display animates/highlights to show it's in "detection mode."

## Effort Estimate

- Frontend hook + UI button: 2-3 hours
- Keyboard shortcut integration: 1 hour
- Visual feedback/animations: 1-2 hours
- **Total: half day**

## Open Questions

- Should tapping while playing stop playback first, or update BPM live mid-play?
  - Recommendation: update live (most hardware metronomes do this)
- Should the floating widget also have a tap area?
  - Nice to have but not required for v1
