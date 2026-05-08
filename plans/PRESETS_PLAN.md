# Presets / Saved Configurations Plan

## Motivation

Musicians practice different styles/exercises at different tempos and settings. Currently they have to manually reconfigure BPM, subdivision, time signature, sound type, and speed ramp every time they switch contexts. Presets let them save named configurations and recall them instantly — via UI, hotkey, or MIDI pedal (future).

## What a Preset Contains

```typescript
interface Preset {
  id: string;            // uuid
  name: string;          // e.g. "Jazz Triplets", "Metal 16ths", "Warm-up"
  bpm: number;
  subdivision: number;   // 1-6
  timeSignature: number; // beats per bar
  soundType: string;     // "click" | "wood" | "beep" | "drum"
  volume: number;        // 0.0–1.0
  speedRamp?: {          // optional — only if preset is a drill
    startBpm: number;
    targetBpm: number;
    increment: number;
    decrement: number;
    barsPerStep: number;
    beatsPerBar: number;
    mode: string;
    cyclic: boolean;
  };
  accentPattern?: number[]; // future: custom accent pattern
}
```

**NOT stored in preset** (these are app-level preferences, not musical configs):
- Theme, widget mode, corner position, always-on-top

## Storage

Use `tauri-plugin-store` — presets stored in a `presets.json` file alongside existing `settings.json`.

```json
{
  "presets": [
    { "id": "abc123", "name": "Jazz Swing", "bpm": 140, "subdivision": 3, ... },
    { "id": "def456", "name": "Speed Drill 120→180", "bpm": 120, ... }
  ],
  "lastActivePreset": "abc123"
}
```

## IPC Commands

| Command | Args | Description |
|---------|------|-------------|
| `list_presets` | — | Returns all saved presets |
| `save_preset` | `{ preset }` | Create or update a preset |
| `delete_preset` | `{ id }` | Remove a preset |
| `load_preset` | `{ id }` | Apply preset to current state |
| `duplicate_preset` | `{ id }` | Clone with "(copy)" suffix |

## UI Design

### Main Window — Preset Bar

A horizontal strip above/below the BPM display:

```
┌─────────────────────────────────────────┐
│ [Jazz Swing ▾]  [+]  [💾]              │
└─────────────────────────────────────────┘
```

- **Dropdown/selector** showing current preset name (or "Unsaved" if modified)
- **[+]** button to save current settings as new preset
- **[💾]** button to update current preset with changed settings
- Dropdown lists all presets with delete/rename option on hover

### Quick-switch

- Keyboard shortcut: `Cmd/Ctrl + 1-9` to load presets by position
- MIDI binding (future): assign a CC/note to "next preset" / "prev preset" / specific preset

### Dirty State

When a user modifies settings after loading a preset, show a dot/indicator that current state differs from the loaded preset. Offer "Save" or "Revert."

## Implementation Order

1. **Rust**: Add `Preset` struct, IPC commands, store read/write
2. **Frontend**: Preset selector UI in MainWindow header
3. **Hotkeys**: Cmd+1-9 for quick-switch (register in global shortcuts)
4. **MIDI mapping** (future): bind preset switching to pedal

## Effort Estimate

- Rust backend (struct, commands, persistence): half day
- Frontend UI (selector, save dialog, dirty indicator): 1-1.5 days
- Quick-switch hotkeys: 2-3 hours
- **Total: ~2 days**

## Default Presets (ship out of box)

Ship 3-4 built-in presets so users see the feature immediately:

| Name | BPM | Subdivision | Time Sig | Sound |
|------|-----|-------------|----------|-------|
| Simple Click | 120 | 1 (quarter) | 4/4 | click |
| Swing Practice | 140 | 3 (triplet) | 4/4 | wood |
| Double-time Warmup | 90 | 4 (16th) | 4/4 | click |
| Speed Drill 100→160 | 100 | 1 | 4/4 | beep | (with speed ramp configured) |
