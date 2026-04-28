use crate::state::SharedState;
use rodio::{OutputStream, Sink, Source};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// Embedded click sounds — 4 kits
const CLICK_HIGH: &[u8] = include_bytes!("../sounds/click_high.wav");
const CLICK_LOW: &[u8] = include_bytes!("../sounds/click_low.wav");
const WOOD_HIGH: &[u8] = include_bytes!("../sounds/wood_high.wav");
const WOOD_LOW: &[u8] = include_bytes!("../sounds/wood_low.wav");
const BEEP_HIGH: &[u8] = include_bytes!("../sounds/beep_high.wav");
const BEEP_LOW: &[u8] = include_bytes!("../sounds/beep_low.wav");
const DRUM_HIGH: &[u8] = include_bytes!("../sounds/drum_high.wav");
const DRUM_LOW: &[u8] = include_bytes!("../sounds/drum_low.wav");

fn get_sounds(sound_type: &str) -> (&'static [u8], &'static [u8]) {
    match sound_type {
        "wood" => (WOOD_HIGH, WOOD_LOW),
        "beep" => (BEEP_HIGH, BEEP_LOW),
        "drum" => (DRUM_HIGH, DRUM_LOW),
        _ => (CLICK_HIGH, CLICK_LOW),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BeatEvent {
    pub beat: u32,
    pub subdivision: u32,
    #[serde(rename = "isDownbeat")]
    pub is_downbeat: bool,
}

pub struct MetronomeEngine {
    alive: Arc<AtomicBool>,
    playing: Arc<AtomicBool>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl MetronomeEngine {
    pub fn new() -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(false)),
            playing: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
        }
    }

    /// Ensure the audio thread is running (opens audio device once).
    fn ensure_thread(&mut self, state: SharedState, app_handle: AppHandle) {
        if self.alive.load(Ordering::SeqCst) {
            return;
        }

        self.alive.store(true, Ordering::SeqCst);
        let alive = self.alive.clone();
        let playing = self.playing.clone();

        let handle = thread::spawn(move || {
            let (_stream, stream_handle) = match OutputStream::try_default() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to open audio stream: {}", e);
                    return;
                }
            };

            let sink = Sink::try_new(&stream_handle).unwrap();

            let mut beat_count: u32 = 0;
            let mut sub_count: u32 = 0;
            let mut next_tick = Instant::now();

            while alive.load(Ordering::SeqCst) {
                // If not playing, idle-wait (low CPU) until play or shutdown
                if !playing.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(10));
                    // Reset timing so first beat is instant when play resumes
                    next_tick = Instant::now();
                    beat_count = 0;
                    sub_count = 0;
                    continue;
                }

                let (bpm, subdivision, volume, sound_type, time_sig) = {
                    let s = state.lock().unwrap();
                    (s.bpm, s.subdivision, s.volume, s.sound_type.clone(), s.time_signature)
                };

                sink.set_volume(volume);

                let beat_duration_ms = 60_000.0 / bpm as f64;
                let ticks_per_beat = subdivision as f64;
                let tick_duration = Duration::from_secs_f64(beat_duration_ms / ticks_per_beat / 1000.0);

                // Wait until next tick
                let now = Instant::now();
                if next_tick > now {
                    let sleep_until = now + (next_tick - now).saturating_sub(Duration::from_millis(1));
                    while Instant::now() < sleep_until {
                        if !playing.load(Ordering::SeqCst) || !alive.load(Ordering::SeqCst) {
                            continue; // Will be caught by outer loop
                        }
                        let remaining = sleep_until.saturating_duration_since(Instant::now());
                        thread::sleep(remaining.min(Duration::from_millis(5)));
                    }
                    while Instant::now() < next_tick {
                        if !playing.load(Ordering::SeqCst) || !alive.load(Ordering::SeqCst) {
                            break;
                        }
                        std::hint::spin_loop();
                    }
                    // Re-check after waiting
                    if !playing.load(Ordering::SeqCst) {
                        continue;
                    }
                }

                // Play click
                let is_downbeat = sub_count == 0;
                let use_accent = match time_sig {
                    0 => false,
                    1 => is_downbeat,
                    _ => {
                        let beats_per_measure = time_sig as u32;
                        is_downbeat && (beat_count % beats_per_measure) == 0
                    }
                };
                let (high_sound, low_sound) = get_sounds(&sound_type);
                let sound_data = if use_accent { high_sound } else { low_sound };
                let cursor = Cursor::new(sound_data);
                if let Ok(source) = rodio::Decoder::new(cursor) {
                    sink.append(source.amplify(if use_accent { 1.0 } else { 0.7 }));
                }

                let event = BeatEvent {
                    beat: beat_count,
                    subdivision: sub_count,
                    is_downbeat,
                };
                let _ = app_handle.emit("beat", &event);

                sub_count += 1;
                if sub_count >= subdivision as u32 {
                    sub_count = 0;
                    beat_count += 1;
                }

                next_tick += tick_duration;
            }
        });

        self.thread_handle = Some(handle);
    }

    pub fn start(&mut self, state: SharedState, app_handle: AppHandle) {
        self.ensure_thread(state, app_handle);
        self.playing.store(true, Ordering::SeqCst);
    }

    pub fn stop(&mut self) {
        self.playing.store(false, Ordering::SeqCst);
    }

    /// Fully stop playback and tear down the audio thread.
    pub fn shutdown(&mut self) {
        self.playing.store(false, Ordering::SeqCst);
        self.alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }

    pub fn is_running(&self) -> bool {
        self.playing.load(Ordering::SeqCst)
    }
}

impl Drop for MetronomeEngine {
    fn drop(&mut self) {
        self.playing.store(false, Ordering::SeqCst);
        self.alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}
