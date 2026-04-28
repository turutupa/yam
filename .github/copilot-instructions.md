---
applyTo: "mustik/**"
---

# Mustik — Floating Global Metronome

## What This Project Is

Mustik is a cross-platform desktop metronome (macOS/Windows/Linux) built with **Rust + Tauri v2 + React + TypeScript**. It is a musician-grade system utility — think Raycast or a DAW transport bar, but for rhythm practice. It runs in the background with a persistent floating widget on screen.

## Tech Stack

| Layer | Tech | Purpose |
|-------|------|---------|
| Core engine | **Rust** | High-precision audio timing, state management |
| Desktop shell | **Tauri v2** | Multi-window app, IPC, system tray, global shortcuts |
| Audio | **rodio** (Rust crate) | WAV playback with `Sink` + `Decoder` |
| Audio low-level | **cpal** (Rust crate) | Audio device access (rodio dependency) |
| Frontend | **React 18 + TypeScript** | UI for both windows |
| Bundler | **Vite** | Dev server + production build |
| Persistence | **tauri-plugin-store** | Settings storage (planned) |
| Hotkeys | **tauri-plugin-global-shortcut** | OS-level keyboard hooks |

## Project Structure

```
mustik/
├── package.json              # Node deps (React, Tauri CLI, Vite)
├── .npmrc                    # Registry: https://npme.walmart.com
├── vite.config.ts            # Vite config, port 1420, ignores src-tauri/
├── tsconfig.json             # Strict TS, ES2020, React JSX
├── index.html                # Entry point, loads /src/main.tsx
│
├── src/                      # FRONTEND (React + TypeScript)
│   ├── main.tsx              # React root mount
│   ├── App.tsx               # Routes to MainWindow or FloatingWidget based on ?window= param
│   ├── types.ts              # Shared types: AppState, BeatEvent, Subdivision, etc.
│   ├── ipc.ts                # Tauri invoke wrappers + event listeners
│   ├── hooks/
│   │   └── useMetronome.ts   # React hook: subscribes to beat events + state changes
│   ├── components/
│   │   ├── MainWindow.tsx    # Full settings UI (BPM, subdivision, mode, hotkeys ref)
│   │   └── FloatingWidget.tsx # Compact mode (BPM+play) and Comfortable mode (BPM+sub+pulse)
│   └── styles/
│       ├── global.css        # CSS variables, reset, dark theme
│       ├── main-window.css   # Main window layout styles
│       └── floating-widget.css # Widget styles, pulse dot animation
│
├── src-tauri/                # RUST BACKEND
│   ├── Cargo.toml            # Rust deps: tauri 2, rodio, cpal, serde, plugins
│   ├── tauri.conf.json       # Tauri config: 2 windows, tray icon, CSP, plugins
│   ├── build.rs              # tauri_build::build()
│   ├── .cargo/config.toml    # Cargo registry protocol config
│   ├── capabilities/
│   │   └── default.json      # Tauri v2 permissions (window, shortcuts, store)
│   ├── sounds/
│   │   ├── click_high.wav    # Downbeat click (1200Hz, 25ms, exponential decay)
│   │   └── click_low.wav     # Subdivision click (800Hz, 20ms, exponential decay)
│   ├── icons/
│   │   └── icon.png          # 32x32 tray icon
│   └── src/
│       ├── main.rs           # Binary entry: calls mustik_lib::run()
│       ├── lib.rs            # App setup: plugins, tray, global shortcuts, command handler
│       ├── state.rs          # AppState struct + Arc<Mutex<AppState>> (SharedState)
│       ├── engine.rs         # MetronomeEngine: audio thread, lookahead timing, beat events
│       └── commands.rs       # 8 Tauri IPC commands + EngineState wrapper
│
└── generate_sounds.py        # Python script to regenerate click WAV files
```

## Architecture

### Two Windows
- **Main window** (`?window=main`): 420×640, decorated, centered. Full settings panel.
- **Floating widget** (`?window=floating`): 240×120, no decorations, transparent, always-on-top, skip taskbar. Stays visible during practice.

Both windows share the same React app — `App.tsx` reads the `?window=` URL param to decide which component to render.

### Rust Core Engine (`engine.rs`)
The metronome engine runs on a **dedicated Rust thread** (NOT the UI thread). Key design:

1. **Lookahead timing** — Uses `std::time::Instant` for a high-resolution clock
2. **Hybrid sleep** — `thread::sleep()` for bulk waiting, then **spin-wait** (`spin_loop()`) for the final ~1ms to achieve sub-millisecond precision
3. **Audio via rodio** — WAV bytes are `include_bytes!()` at compile time, decoded and played through a `Sink`
4. **Beat events** — Each tick emits a `beat` event via `app_handle.emit()` to both windows
5. **Live BPM changes** — Reads BPM/subdivision from `SharedState` each tick, so changes take effect immediately

### State Management
- **Rust side**: `Arc<Mutex<AppState>>` managed by Tauri. Commands lock, mutate, and emit `state-changed` events.
- **React side**: `useMetronome` hook listens to `state-changed` and `beat` events. All mutations go through `invoke()` calls to Rust.
- **Flow**: React → `invoke("set_bpm")` → Rust mutates state → emits `state-changed` → React updates

### Global Shortcuts (registered in `lib.rs`)
| Key | Action |
|-----|--------|
| `Space` | Toggle play/stop |
| `Up`/`Down` | BPM ±1 |
| `Shift+Up`/`Shift+Down` | BPM ±5 |
| `Tab` | Toggle compact/comfortable mode |

### System Tray
Menu with "Show Mustik" and "Quit" items.

## State Shape

```rust
pub struct AppState {
    pub bpm: u16,           // 20–300
    pub is_playing: bool,
    pub subdivision: u8,    // 1=quarter, 2=eighth, 3=triplet, 4=sixteenth
    pub mode: String,       // "compact" | "comfortable"
    pub corner: String,     // "top-left" | "top-right" | "bottom-left" | "bottom-right"
    pub always_on_top: bool,
}
```

JSON serialization uses camelCase (`isPlaying`, `alwaysOnTop`) for the frontend.

## IPC Commands (Tauri invoke handlers)

| Command | Args | Description |
|---------|------|-------------|
| `get_state` | — | Returns full `AppState` |
| `set_bpm` | `{ bpm: u16 }` | Clamps 20–300, emits state-changed |
| `set_subdivision` | `{ subdivision: u8 }` | Clamps 1–4, emits state-changed |
| `toggle_playback` | — | Starts or stops engine + emits |
| `set_playing` | `{ playing: bool }` | Explicit start/stop |
| `set_widget_mode` | `{ mode: String }` | "compact" or "comfortable" |
| `set_corner` | `{ corner: String }` | Widget position |
| `set_always_on_top` | `{ enabled: bool }` | Toggle always-on-top |

## Events (Rust → Frontend)

| Event | Payload | Emitted by |
|-------|---------|------------|
| `state-changed` | `AppState` | Every command that mutates state |
| `beat` | `{ beat, subdivision, isDownbeat }` | Engine on each tick |

## Build & Run

```bash
cd mustik
npm install
npm run tauri dev    # Dev mode with HMR
npm run tauri build  # Production binary
```

Requires: Rust (stable), Node.js 18+, platform Tauri deps.

**Note**: Corporate network blocks `crates.io` DNS. Use home/VPN network for `cargo` deps. The npm registry is configured to `https://npme.walmart.com` in `.npmrc`.

## Future Work (from project plan)

- **Phase 2**: Subdivision number hotkeys (1-4)
- **Phase 3**: Corner anchoring with snap, pulse animation sync
- **Phase 4**: Footswitch/HID input, MIDI input, startup/background mode
- **Phase 5**: Smooth animations, click-through mode, settings persistence, multi-monitor

## Conventions

- Rust: `snake_case`, serde rename to `camelCase` for frontend
- React: Functional components, hooks only, no class components
- CSS: Custom properties in `:root`, BEM-ish class names
- All state mutations go through Tauri IPC commands (single source of truth in Rust)
- Audio engine is always on a dedicated thread, never on UI thread
