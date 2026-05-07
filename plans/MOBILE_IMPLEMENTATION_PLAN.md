# Mobile (Android/iOS) Implementation Plan

## Motivation

Yames is a desktop metronome built with Tauri v2. Tauri v2 officially supports Android and iOS targets, making a mobile port technically feasible. However, the audio engine relies on desktop-specific assumptions (dedicated threads, spin-loop timing, rodio/cpal output) that don't translate directly to mobile platforms.

This document outlines what can be reused, what must be rewritten, and key platform constraints to consider.

---

## What Can Be Reused

| Component | Reusable? | Notes |
|-----------|-----------|-------|
| Frontend UI (React) | ✅ Fully | WebView-based, works as-is with responsive tweaks |
| Tauri IPC commands | ✅ Fully | Same command interface on mobile |
| BPM/subdivision/accent logic | ✅ Fully | Pure math, no platform deps |
| Speed ramp engine | ✅ Fully | State machine logic, platform-agnostic |
| Theme system | ✅ Fully | CSS variables in webview |
| Zen effects (Canvas) | ✅ Mostly | May need perf tuning on low-end Android |
| Sound assets (WAV) | ✅ Fully | Embedded bytes, format is universal |
| Audio timing strategy | ❌ Rewrite | Spin-loop + thread::sleep not viable on mobile |
| Audio output (rodio/cpal) | ❌ Rewrite | Need platform-native audio APIs |
| Window management | ❌ N/A | No floating widget, always-on-top, etc. on mobile |
| Global shortcuts | ❌ N/A | No OS-level hotkeys on mobile |
| Gamepad/footswitch | ⚠️ Partial | Bluetooth MIDI possible, HID gamepad unlikely |

---

## Audio Engine: Mobile Strategy

### The Problem

The current engine (`engine.rs`) uses:
1. **`thread::sleep`** for coarse timing → mobile OS may throttle background threads
2. **`spin_loop` busy-wait** for sub-ms precision → will drain battery and trigger OS kills
3. **rodio `Sink::append`** for playback → rodio uses cpal which has limited mobile support

### Recommended Approach: Platform Audio Callbacks

Instead of "push" timing (we decide when to play), use "pull" timing (the audio system asks us for samples):

#### iOS — AVAudioEngine / Audio Unit

```
┌─────────────────────────────────────────┐
│  Audio Render Callback (real-time thread)│
│                                          │
│  Called by CoreAudio every ~5ms          │
│  Fill buffer with silence or click sample│
│  Track sample position for beat timing   │
└─────────────────────────────────────────┘
```

- **Latency:** ~5-12ms (excellent)
- **API:** `AVAudioEngine` with `AVAudioSourceNode`, or raw Audio Units via `kAudioUnitSubType_RemoteIO`
- **Rust binding:** Use `objc2` crate or write Swift bridge
- **Background audio:** Requires `AVAudioSession` category `.playback` and background mode entitlement

#### Android — Oboe (AAudio/OpenSL ES)

```
┌─────────────────────────────────────────┐
│  Oboe Audio Callback (real-time thread)  │
│                                          │
│  Called by AAudio every ~10ms            │
│  Fill buffer with silence or click sample│
│  Track frame position for beat timing    │
└─────────────────────────────────────────┘
```

- **Latency:** ~10-25ms (good on modern devices, 50-100ms on older ones)
- **API:** Oboe C++ library (wraps AAudio on API 27+, falls back to OpenSL ES)
- **Rust binding:** `oboe-rs` crate or FFI to C++ via `cxx`
- **Background audio:** Requires foreground service with `FOREGROUND_SERVICE_MEDIA_PLAYBACK`

### Timing in Callback Model

Instead of sleeping until the next tick, the audio callback model works by counting samples:

```rust
struct MobileEngine {
    sample_rate: u32,          // e.g. 48000
    samples_per_tick: u32,     // (sample_rate * 60) / (bpm * subdivisions)
    sample_counter: u32,       // counts up each callback
    click_samples: Vec<i16>,   // decoded WAV click sound
    click_position: usize,     // current playback position in click
}

fn audio_callback(buffer: &mut [i16], frames: u32) {
    for frame in buffer.chunks_mut(channels) {
        if self.sample_counter >= self.samples_per_tick {
            self.sample_counter = 0;
            self.click_position = 0; // trigger click
            // emit beat event to frontend
        }
        // Mix click sample or silence
        if self.click_position < self.click_samples.len() {
            frame[0] = self.click_samples[self.click_position];
            self.click_position += 1;
        }
        self.sample_counter += 1;
    }
}
```

**Advantages:**
- Zero jitter — timing is sample-accurate (sub-sample precision)
- No CPU waste — only runs when audio system needs data
- Battery efficient — OS manages thread scheduling
- Actually more precise than the desktop spin-loop approach

---

## Platform-Specific Considerations

### iOS

| Concern | Solution |
|---------|----------|
| Background audio | `AVAudioSession.setCategory(.playback)` + Info.plist `UIBackgroundModes: audio` |
| Interruptions (calls, Siri) | Handle `AVAudioSession.interruptionNotification` — pause/resume |
| Silent mode switch | `.playback` category ignores silent switch (correct for metronome) |
| Screen lock | Audio continues; UI updates pause (acceptable) |
| App Store review | Straightforward — utility app, no IAP needed |
| Haptic feedback on beat | `UIImpactFeedbackGenerator` — nice optional feature |

### Android

| Concern | Solution |
|---------|----------|
| Background playback | Foreground service with persistent notification |
| Audio focus | Request `AUDIOFOCUS_GAIN` — duck or pause if lost |
| Doze mode | Foreground service exempts from Doze |
| Fragmentation | Oboe handles API level differences (AAudio vs OpenSL) |
| Latency variance | Detect low-latency support via `AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER` |
| Play Store | Straightforward — no special permissions beyond `FOREGROUND_SERVICE` |

---

## UI Adaptations

### Must Change
- **Remove window controls** — no title bar drag, no minimize/maximize
- **Remove floating widget** — not applicable on mobile
- **Remove global shortcuts** — replace with media button handling
- **Touch-friendly BPM control** — larger tap targets, swipe gestures for ±BPM
- **Responsive layout** — already flex-based, but needs phone-width testing

### Nice to Have
- **Haptic pulse on beat** — physical feedback per tick
- **Keep screen awake** — `WakeLock` on Android, `UIApplication.isIdleTimerDisabled` on iOS
- **Tap tempo via screen tap** — already exists but ensure touch event handling
- **Landscape mode** — optional, lock to portrait initially
- **Bluetooth MIDI pedals** — CoreMIDI on iOS, Android MIDI API — reuse desktop MIDI plan

---

## Dependency Changes

| Desktop | Mobile Replacement |
|---------|-------------------|
| `rodio` | Remove — use platform audio callbacks |
| `cpal` | Remove — replaced by Oboe / CoreAudio |
| `tauri-plugin-global-shortcut` | Remove — no mobile equivalent |
| `tauri-plugin-store` | ✅ Keep — works on mobile |
| (new) `oboe-rs` or `cxx` | Android audio callback |
| (new) `objc2` or Swift bridge | iOS audio callback |

---

## Suggested Implementation Order

1. **Scaffold mobile targets** — `tauri android init` / `tauri ios init`
2. **Get UI running** — verify webview renders correctly on both platforms
3. **Implement iOS audio engine** — AVAudioSourceNode + sample-counting
4. **Implement Android audio engine** — Oboe callback + sample-counting
5. **Abstract engine trait** — shared interface between desktop and mobile engines
6. **Remove desktop-only features** — conditional compile (`#[cfg(mobile)]`) for widget, shortcuts
7. **Add mobile-specific features** — haptics, wake lock, media button handling
8. **Test latency** — measure actual beat accuracy on real devices
9. **UI polish** — responsive tweaks, touch targets, safe area insets

---

## Estimated Effort

| Task | Effort |
|------|--------|
| iOS audio engine | 2-3 days |
| Android audio engine (Oboe) | 3-4 days |
| Engine trait abstraction | 1 day |
| UI responsive/mobile tweaks | 2-3 days |
| Platform-specific features (haptics, wake lock, etc.) | 1-2 days |
| Testing on real devices | 2-3 days |
| **Total** | **~2-3 weeks** |

---

## Open Questions

- **Single codebase or separate engine files?** — Recommend `src-tauri/src/engine_desktop.rs` + `src-tauri/src/engine_mobile.rs` behind `#[cfg]` gates, sharing a common `EngineTrait`
- **Ship as same app or separate listing?** — Probably separate (different UX expectations)
- **Minimum OS versions?** — iOS 15+ (AVAudioSourceNode), Android API 27+ (AAudio via Oboe)
- **Monetization on mobile?** — Free with optional tip jar? Or just free to match desktop?
