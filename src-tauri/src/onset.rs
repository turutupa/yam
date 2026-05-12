use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::audio_input::SharedAudioInput;

/// A detected onset event.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Onset {
    /// Monotonic timestamp in nanoseconds (from Instant)
    #[serde(rename = "tsNs")]
    pub ts_ns: u64,
    /// Peak amplitude at onset (0.0–1.0)
    pub amplitude: f32,
    /// Spectral centroid at onset (Hz) — higher = brighter sound
    pub centroid: f32,
}

/// Onset detector using spectral flux with adaptive threshold.
///
/// Runs on a dedicated analyzer thread, consuming samples from the audio input
/// ring buffer. Emits `Onset` events through a callback.
pub struct OnsetDetector {
    alive: Arc<AtomicBool>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl OnsetDetector {
    pub fn new() -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
        }
    }

    /// Start the onset detection thread.
    /// `on_onset` is called from the analyzer thread for each detected onset.
    pub fn start<F>(
        &mut self,
        audio_input: SharedAudioInput,
        on_onset: F,
    ) where
        F: Fn(Onset) + Send + 'static,
    {
        self.stop();
        self.alive.store(true, Ordering::SeqCst);
        let alive = self.alive.clone();

        self.thread_handle = Some(thread::spawn(move || {
            Self::detect_loop(alive, audio_input, on_onset);
        }));
    }

    pub fn stop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }

    pub fn is_active(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Main detection loop. Processes audio in hops, computes spectral flux,
    /// applies adaptive threshold, and emits onsets.
    fn detect_loop<F>(
        alive: Arc<AtomicBool>,
        audio_input: SharedAudioInput,
        on_onset: F,
    ) where
        F: Fn(Onset) + Send + 'static,
    {
        let fft_size = 1024_usize;
        let hop_size = 512_usize;
        let half = fft_size / 2;

        // Hann window
        let window: Vec<f32> = (0..fft_size)
            .map(|i| {
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (fft_size - 1) as f32).cos())
            })
            .collect();

        // Previous magnitude spectrum for flux computation
        let mut prev_mags = vec![0.0_f32; half];

        // Adaptive threshold: ring buffer of recent flux values
        let flux_history_len = 100; // ~1 second at hop_size=512, 48kHz (~10ms per hop)
        let mut flux_history = vec![0.0_f32; flux_history_len];
        let mut flux_write_pos = 0;
        let threshold_multiplier = 1.5_f32;
        let min_amplitude = 0.01_f32;

        // Refractory period: minimum 50ms between onsets
        let refractory_ns = 50_000_000_u64; // 50ms in nanoseconds
        let mut last_onset_ns: u64 = 0;

        // Reference time uses shared clock for cross-thread comparability
        let sample_rate = {
            let ai = audio_input.lock().unwrap();
            ai.sample_rate()
        };

        while alive.load(Ordering::SeqCst) {
            // Sleep a bit between processing (don't spin-wait)
            thread::sleep(Duration::from_millis(5));
            if !alive.load(Ordering::SeqCst) {
                break;
            }

            // Read available samples from ring buffer
            let new_samples = {
                let ai = audio_input.lock().unwrap();
                let ring = ai.ring();
                let r = ring.lock().unwrap();
                // Read the last 4096 samples (more than we need) and determine
                // what's new since our last read
                r.read_last(fft_size * 4)
            };

            if new_samples.len() < fft_size {
                continue;
            }

            // Process in hops. We overlap by hop_size.
            let total_available = new_samples.len();
            let offset = if total_available > fft_size {
                total_available - fft_size
            } else {
                0
            };

            // Only process the most recent complete frame to avoid falling behind
            if offset + fft_size > total_available {
                continue;
            }

            let frame = &new_samples[offset..offset + fft_size];

            // Apply window
            let windowed: Vec<f32> = frame.iter().zip(&window).map(|(s, w)| s * w).collect();

            // Compute magnitude spectrum using DFT for each bin
            // For 512 bins this is expensive, so we use a simplified approach:
            // compute magnitude only for bins we need (every 4th bin for flux)
            // Actually, let's compute full magnitudes using the Goertzel algorithm
            // which is O(N) per bin but gives us exact values.
            // For 512 bins × 1024 samples = ~500K ops, runs in <1ms.
            let mut mags = vec![0.0_f32; half];
            for k in 0..half {
                let freq = 2.0 * std::f32::consts::PI * k as f32 / fft_size as f32;
                let coeff = 2.0 * freq.cos();
                let mut s1 = 0.0_f32;
                let mut s2 = 0.0_f32;
                for &x in &windowed {
                    let s0 = x + coeff * s1 - s2;
                    s2 = s1;
                    s1 = s0;
                }
                let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
                mags[k] = power.max(0.0).sqrt();
            }

            // Spectral flux: sum of positive differences (half-wave rectification)
            let mut flux = 0.0_f32;
            for k in 0..half {
                let diff = mags[k] - prev_mags[k];
                if diff > 0.0 {
                    flux += diff;
                }
            }

            // Compute spectral centroid for this frame
            let mag_sum: f32 = mags.iter().sum();
            let centroid = if mag_sum > 0.0001 {
                let weighted: f32 = mags
                    .iter()
                    .enumerate()
                    .map(|(k, &m)| k as f32 * sample_rate as f32 / fft_size as f32 * m)
                    .sum();
                weighted / mag_sum
            } else {
                0.0
            };

            // Compute RMS amplitude
            let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();

            // Update previous magnitudes
            prev_mags.copy_from_slice(&mags);

            // Update flux history for adaptive threshold
            flux_history[flux_write_pos] = flux;
            flux_write_pos = (flux_write_pos + 1) % flux_history_len;

            // Adaptive threshold: median of recent flux × multiplier
            let threshold = {
                let mut sorted = flux_history.clone();
                sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let median = sorted[sorted.len() / 2];
                median * threshold_multiplier + 0.001 // small floor to avoid triggering on silence
            };

            // Check for onset
            if flux > threshold && rms > min_amplitude {
                let now_ns = crate::clock::now_ns();

                // Refractory period check
                if now_ns - last_onset_ns >= refractory_ns {
                    last_onset_ns = now_ns;

                    let onset = Onset {
                        ts_ns: now_ns,
                        amplitude: rms.clamp(0.0, 1.0),
                        centroid,
                    };
                    on_onset(onset);
                }
            }
        }
    }
}

impl Drop for OnsetDetector {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type SharedOnsetDetector = Arc<Mutex<OnsetDetector>>;

pub fn create_shared_onset_detector() -> SharedOnsetDetector {
    Arc::new(Mutex::new(OnsetDetector::new()))
}
