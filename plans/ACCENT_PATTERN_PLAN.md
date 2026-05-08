# Accent Pattern Customization Plan

## Motivation

Currently `time_signature` is a single `u8` (beats per bar) that determines which beat gets accented (beat 1 = loud, rest = normal). This covers simple meters (4/4, 3/4, 6/8) but can't express:

- **Odd groupings**: 7/8 as 3+2+2, or 2+2+3
- **Compound meters**: 12/8 as 3+3+3+3 with group accents
- **Latin/world patterns**: 3+3+2 (tresillo), 2+3+2+3 (son clave emphasis)
- **Custom accent levels**: Some beats louder, some ghosted, some muted

Musicians practicing odd meters or polyrhythmic patterns need this control.

## Design

### Accent Pattern Model

Instead of a single `time_signature: u8`, support a per-beat accent level array:

```rust
// Current (stays as default/simple mode):
pub time_signature: u8,  // e.g., 4 → accent beat 1 of 4

// New (custom mode):
pub accent_pattern: Option<Vec<u8>>,  // e.g., [3, 1, 1, 2, 1, 1, 2] for 7/8 (3+2+2)
```

**Accent levels:**
- `0` = muted (no click)
- `1` = soft (subdivision volume)
- `2` = normal (standard beat)
- `3` = accented (loud, downbeat sound)

### Examples

| Meter | Pattern | Accent Array |
|-------|---------|--------------|
| 4/4 standard | ● ○ ○ ○ | `[3, 1, 1, 1]` |
| 3/4 waltz | ● ○ ○ | `[3, 1, 1]` |
| 7/8 (3+2+2) | ● ○ ○ ● ○ ● ○ | `[3, 1, 1, 2, 1, 2, 1]` |
| 7/8 (2+2+3) | ● ○ ● ○ ● ○ ○ | `[3, 1, 2, 1, 2, 1, 1]` |
| 5/4 (3+2) | ● ○ ○ ● ○ | `[3, 1, 1, 2, 1]` |
| Tresillo (3+3+2) | ● ○ ○ ● ○ ○ ● ○ | `[3, 1, 1, 3, 1, 1, 3, 1]` |
| 12/8 grouped | ● ○ ○ ● ○ ○ ● ○ ○ ● ○ ○ | `[3, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1]` |

### Backward Compatibility

- If `accent_pattern` is `None` → use current `time_signature` behavior (accent beat 1 only)
- Existing users unaffected
- Old presets still work

## Rust Changes

### State (`state.rs`)

```rust
pub struct AppState {
    // ... existing fields ...
    pub time_signature: u8,
    #[serde(rename = "accentPattern")]
    pub accent_pattern: Option<Vec<u8>>,  // NEW
}
```

### Engine (`engine.rs`)

Currently the engine checks `beat_in_bar == 0` for downbeat. Change to:

```rust
// Current logic (simplified):
let volume = if beat_in_bar == 0 { ACCENT_VOL } else { NORMAL_VOL };

// New logic:
let volume = match &state.accent_pattern {
    Some(pattern) => {
        let idx = beat_in_bar % pattern.len();
        match pattern[idx] {
            0 => 0.0,           // muted
            1 => SUB_VOL,       // soft
            2 => NORMAL_VOL,    // normal
            3 => ACCENT_VOL,    // accented
            _ => NORMAL_VOL,
        }
    }
    None => {
        // Legacy behavior
        if beat_in_bar == 0 { ACCENT_VOL } else { NORMAL_VOL }
    }
};
```

### New IPC Command

```rust
#[tauri::command]
pub fn set_accent_pattern(
    state: State<'_, SharedState>,
    app: AppHandle,
    pattern: Option<Vec<u8>>,  // None clears custom pattern
) -> Result<(), String> {
    // Validate: all values 0-3, length 1-32
    // Mutate state, emit state-changed
}
```

## UI Design

### Pattern Editor (Main Window — Metronome tab)

A row of clickable circles representing beats in the bar. Click to cycle through accent levels:

```
Accent Pattern:  ● ◉ ○ ◉ ○ ◉ ○     [+ beat] [- beat]
                 3  2  1  2  1  2  1

Legend: ● = accent  ◉ = normal  ○ = soft  · = mute
```

- **Click a dot** → cycle: mute → soft → normal → accent → mute
- **[+] / [-] buttons** → add/remove beats from the pattern
- **Preset patterns dropdown** → common meters (4/4, 3/4, 7/8 variants, tresillo, etc.)
- **Visual**: During playback, the current beat highlights/pulses in the row

### Beat Visualizer

The existing beat dot display should reflect custom accents — bigger dot for accent, smaller for soft, hidden for mute.

## Built-in Pattern Presets

Dropdown with common patterns so users don't have to build from scratch:

| Name | Array |
|------|-------|
| 4/4 Standard | `[3, 1, 1, 1]` |
| 3/4 Waltz | `[3, 1, 1]` |
| 6/8 Compound | `[3, 1, 1, 2, 1, 1]` |
| 5/4 (3+2) | `[3, 1, 1, 2, 1]` |
| 5/4 (2+3) | `[3, 1, 2, 1, 1]` |
| 7/8 (2+2+3) | `[3, 1, 2, 1, 2, 1, 1]` |
| 7/8 (3+2+2) | `[3, 1, 1, 2, 1, 2, 1]` |
| Tresillo | `[3, 1, 1, 3, 1, 1, 3, 1]` |
| Son Clave (3-2) | `[3, 0, 1, 3, 0, 1, 0, 3, 0, 1, 3, 0, 1, 0, 1, 0]` |

## Implementation Order

1. **Rust**: Add `accent_pattern` to AppState, `set_accent_pattern` command, engine logic
2. **Frontend**: Pattern editor UI with click-to-cycle dots
3. **Built-in presets**: Dropdown with common patterns
4. **Beat visualization**: Reflect accent levels in beat dot display
5. **Integration with presets**: Include `accentPattern` in saved presets

## Effort Estimate

- Rust (state + engine + command): half day
- Frontend pattern editor UI: 1-1.5 days
- Beat visualizer updates: half day
- Built-in pattern presets: 2-3 hours
- **Total: ~2.5-3 days**

## Future Extensions

- Import/export patterns as text (e.g., "x..x..x." notation)
- Polyrhythm mode: two patterns overlaid (e.g., 3 over 4)
- Pattern length independent from time signature (polymetric)
