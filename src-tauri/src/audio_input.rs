use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Known audio interface brand patterns for smart default detection.
const INTERFACE_PATTERNS: &[&str] = &[
    "scarlett", "focusrite", "apollo", "motu", "audient", "presonus",
    "behringer", "ssl", "rme", "uad", "universal audio", "steinberg",
    "ur22", "ur44", "babyface", "clarett", "saffire", "tascam",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(rename = "isInterface")]
    pub is_interface: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioSpectrum {
    /// 16 frequency band magnitudes, normalized 0.0–1.0
    pub bands: Vec<f32>,
    /// Overall RMS level, normalized 0.0–1.0
    pub rms: f32,
}

/// Simple ring buffer for audio samples.
/// Protected by Mutex — the audio callback uses try_lock to avoid blocking.
pub struct RingBuffer {
    buf: Vec<f32>,
    write_pos: usize,
    capacity: usize,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buf: vec![0.0; capacity],
            write_pos: 0,
            capacity,
        }
    }

    fn write(&mut self, samples: &[f32]) {
        for &s in samples {
            self.buf[self.write_pos] = s;
            self.write_pos = (self.write_pos + 1) % self.capacity;
        }
    }

    /// Read the last `n` samples in chronological order.
    pub fn read_last(&self, n: usize) -> Vec<f32> {
        let n = n.min(self.capacity);
        let mut out = Vec::with_capacity(n);
        let start = (self.write_pos + self.capacity - n) % self.capacity;
        for i in 0..n {
            out.push(self.buf[(start + i) % self.capacity]);
        }
        out
    }
}

/// Audio input manager. Does NOT hold the cpal::Stream directly (it's not Send).
/// Instead, spawns a dedicated thread that owns the stream and ring buffer writes.
/// Control is via atomic flags (same pattern as MetronomeEngine).
pub struct AudioInput {
    alive: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    ring: Arc<Mutex<RingBuffer>>,
    sample_rate: Arc<Mutex<u32>>,
}

// Safety: AudioInput doesn't hold cpal::Stream — it lives on its own thread.
// The struct only holds Arc<AtomicBool>, Arc<Mutex<...>>, and JoinHandle, all of which are Send+Sync.
unsafe impl Send for AudioInput {}
unsafe impl Sync for AudioInput {}

impl AudioInput {
    pub fn new() -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            ring: Arc::new(Mutex::new(RingBuffer::new(48000 * 4))),
            sample_rate: Arc::new(Mutex::new(48000)),
        }
    }

    /// Enumerate all audio input devices.
    pub fn list_devices() -> Vec<AudioDevice> {
        let host = cpal::default_host();
        let default_name = host
            .default_input_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();

        let mut devices = Vec::new();
        if let Ok(input_devices) = host.input_devices() {
            for device in input_devices {
                if let Ok(name) = device.name() {
                    let lower = name.to_lowercase();
                    let is_interface = INTERFACE_PATTERNS.iter().any(|p| lower.contains(p));
                    devices.push(AudioDevice {
                        is_default: name == default_name,
                        is_interface,
                        name,
                    });
                }
            }
        }
        devices
    }

    /// Start capturing audio from the given device.
    /// Spawns a dedicated thread that owns the cpal stream.
    pub fn start(&mut self, device_name: Option<&str>, app_handle: AppHandle) -> Result<(), String> {
        self.stop();

        // Resolve device and config on the current thread (for error reporting)
        let host = cpal::default_host();
        let device = if let Some(name) = device_name {
            host.input_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("Audio device '{}' not found", name))?
        } else {
            host.default_input_device()
                .ok_or_else(|| "No default input device found".to_string())?
        };

        let default_config = device.default_input_config().map_err(|e| e.to_string())?;
        let sample_format = default_config.sample_format();
        let config = StreamConfig {
            channels: 1,
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };
        let sr = config.sample_rate.0;

        // Update sample rate and resize ring buffer
        {
            *self.sample_rate.lock().unwrap() = sr;
            let mut ring = self.ring.lock().unwrap();
            *ring = RingBuffer::new(sr as usize * 4);
        }

        let alive = self.alive.clone();
        alive.store(true, Ordering::SeqCst);
        let ring = self.ring.clone();
        let sample_rate = sr;
        let device_name_owned = device.name().unwrap_or_default();

        self.capture_thread = Some(thread::spawn(move || {
            // Re-open the device on this thread (cpal streams must be created on the thread that runs them)
            let host = cpal::default_host();
            let device = if let Ok(devices) = host.input_devices() {
                devices.into_iter().find(|d| d.name().ok().as_deref() == Some(&device_name_owned))
            } else {
                None
            };
            let device = match device {
                Some(d) => d,
                None => {
                    eprintln!("Audio input: device disappeared before thread started");
                    return;
                }
            };

            let ring_for_callback = ring.clone();
            let channels = config.channels as usize;

            let stream_result = match sample_format {
                SampleFormat::F32 => device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data.chunks(channels).map(|f| f[0]).collect();
                        if let Ok(mut r) = ring_for_callback.try_lock() {
                            r.write(&mono);
                        }
                    },
                    |err| eprintln!("Audio input error: {}", err),
                    None,
                ),
                SampleFormat::I16 => device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data.chunks(channels)
                            .map(|f| f[0] as f32 / i16::MAX as f32)
                            .collect();
                        if let Ok(mut r) = ring_for_callback.try_lock() {
                            r.write(&mono);
                        }
                    },
                    |err| eprintln!("Audio input error: {}", err),
                    None,
                ),
                _ => {
                    eprintln!("Unsupported sample format: {:?}", sample_format);
                    return;
                }
            };

            let stream = match stream_result {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to build input stream: {}", e);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                eprintln!("Failed to start input stream: {}", e);
                return;
            }

            // Spectrum analysis loop (runs on same thread, stream lives here too)
            Self::spectrum_loop(&alive, &ring, sample_rate, &app_handle);

            // Stream is dropped here when the loop exits, stopping capture
            drop(stream);
        }));

        Ok(())
    }

    pub fn stop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }

    pub fn is_active(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Get a reference to the ring buffer (for onset detection in later phases).
    pub fn ring(&self) -> Arc<Mutex<RingBuffer>> {
        self.ring.clone()
    }

    pub fn sample_rate(&self) -> u32 {
        *self.sample_rate.lock().unwrap()
    }

    /// Compute and emit spectrum data at ~20Hz. Runs until `alive` is set to false.
    fn spectrum_loop(
        alive: &Arc<AtomicBool>,
        ring: &Arc<Mutex<RingBuffer>>,
        sample_rate: u32,
        app_handle: &AppHandle,
    ) {
        let fft_size = 2048_usize;

        // Hann window
        let window: Vec<f32> = (0..fft_size)
            .map(|i| {
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (fft_size - 1) as f32).cos())
            })
            .collect();

        // 16 logarithmically-spaced frequency band edges
        let nyquist = sample_rate as f32 / 2.0;
        let num_bands = 16;
        let half = fft_size / 2;
        let band_edges = log_band_edges(20.0, nyquist.min(20000.0), num_bands, nyquist, half);

        let mut smoothed = vec![0.0_f32; num_bands];
        let decay = 0.7_f32;

        while alive.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(50));
            if !alive.load(Ordering::SeqCst) {
                break;
            }

            let samples = {
                let r = ring.lock().unwrap();
                r.read_last(fft_size)
            };

            if samples.len() < fft_size {
                continue;
            }

            // RMS
            let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();

            // Apply window
            let windowed: Vec<f32> = samples.iter().zip(&window).map(|(s, w)| s * w).collect();

            // Compute energy in each band using Goertzel's algorithm
            let mut band_magnitudes = Vec::with_capacity(num_bands);
            for &(lo, hi) in &band_edges {
                if lo >= hi {
                    band_magnitudes.push(0.0);
                    continue;
                }
                let mut energy = 0.0_f32;
                let bin_count = hi - lo;
                for bin in lo..hi {
                    let freq = 2.0 * std::f32::consts::PI * bin as f32 / fft_size as f32;
                    let coeff = 2.0 * freq.cos();
                    let mut s1 = 0.0_f32;
                    let mut s2 = 0.0_f32;
                    for &x in &windowed {
                        let s0 = x + coeff * s1 - s2;
                        s2 = s1;
                        s1 = s0;
                    }
                    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
                    energy += power.max(0.0).sqrt();
                }
                band_magnitudes.push(energy / bin_count as f32);
            }

            // Normalize
            let max_mag = band_magnitudes.iter().cloned().fold(0.0_f32, f32::max);
            let ref_level = max_mag.max(0.001);
            let normalized: Vec<f32> = band_magnitudes
                .iter()
                .enumerate()
                .map(|(i, &mag)| {
                    let target = (mag / ref_level).clamp(0.0, 1.0);
                    smoothed[i] = smoothed[i] * decay + target * (1.0 - decay);
                    smoothed[i]
                })
                .collect();

            let has_signal = rms > 0.005;
            let spectrum = if has_signal {
                AudioSpectrum {
                    bands: normalized,
                    rms: (rms * 10.0).clamp(0.0, 1.0),
                }
            } else {
                // Decay smoothed values toward zero when silent
                for s in smoothed.iter_mut() {
                    *s *= decay;
                }
                AudioSpectrum {
                    bands: smoothed.clone(),
                    rms: 0.0,
                }
            };
            let _ = app_handle.emit("audio-spectrum", &spectrum);
        }
    }
}

impl Drop for AudioInput {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Compute logarithmically-spaced band edges as FFT bin index pairs.
fn log_band_edges(
    lo_freq: f32,
    hi_freq: f32,
    num_bands: usize,
    nyquist: f32,
    num_bins: usize,
) -> Vec<(usize, usize)> {
    let log_lo = lo_freq.ln();
    let log_hi = hi_freq.ln();
    let mut edges = Vec::with_capacity(num_bands);
    for i in 0..num_bands {
        let f_lo = (log_lo + (log_hi - log_lo) * i as f32 / num_bands as f32).exp();
        let f_hi = (log_lo + (log_hi - log_lo) * (i + 1) as f32 / num_bands as f32).exp();
        let bin_lo = ((f_lo / nyquist) * num_bins as f32).round() as usize;
        let bin_hi = ((f_hi / nyquist) * num_bins as f32).round() as usize;
        // Skip bin 0 (DC offset) — it picks up noise from audio interfaces
        edges.push((bin_lo.max(1).min(num_bins), bin_hi.min(num_bins)));
    }
    edges
}

pub type SharedAudioInput = Arc<Mutex<AudioInput>>;

pub fn create_shared_audio_input() -> SharedAudioInput {
    Arc::new(Mutex::new(AudioInput::new()))
}
