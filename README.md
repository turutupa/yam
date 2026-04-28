# Mustik 🎵

A **musician-grade floating metronome** desktop app built with Rust + Tauri + React.

## Features

- **High-precision audio engine** — Rust-based scheduler with lookahead timing (not setInterval)
- **Floating always-on-top widget** — Stays visible while you practice
- **Compact & Comfortable modes** — Minimal or full-info display
- **Global hotkeys** — Control without focusing the app
- **Subdivision support** — Quarter, eighth, triplet, sixteenth notes

## Tech Stack

- **Rust** — Core metronome engine with precision timing
- **Tauri v2** — Desktop app framework with multi-window support
- **React + TypeScript** — UI layer
- **rodio** — Audio playback

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (v18+)
- Platform-specific Tauri dependencies ([see docs](https://v2.tauri.app/start/prerequisites/))

### Setup

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Controls

| Hotkey | Action |
|--------|--------|
| `Space` | Play / Stop |
| `↑` / `↓` | BPM ±1 |
| `Shift+↑` / `Shift+↓` | BPM ±5 |
| `1`–`4` | Set subdivision |
| `Tab` | Toggle widget mode |

## Architecture

```
┌─────────────────┐     IPC      ┌──────────────────┐
│   Main Window   │◄────────────►│   Rust Engine    │
│   (Settings)    │              │  (Audio + State) │
└─────────────────┘              └──────────────────┘
                                         ▲
┌─────────────────┐     IPC      ────────┘
│ Floating Widget │◄─────────────
│  (Always on top)│
└─────────────────┘
```

## License

MIT
