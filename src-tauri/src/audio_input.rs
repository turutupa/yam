use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
    // Recording
    is_recording: Arc<AtomicBool>,
    recording_buf: Arc<Mutex<Vec<f32>>>,
    // Playback
    playback_alive: Arc<AtomicBool>,
    playback_thread: Option<thread::JoinHandle<()>>,
    recorded_audio: Arc<Mutex<Option<(Vec<f32>, u32)>>>, // (samples, sample_rate)
    input_gain: Arc<AtomicU32>, // f32 linear multiplier stored as bits (1.0 = unity)
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
            is_recording: Arc::new(AtomicBool::new(false)),
            recording_buf: Arc::new(Mutex::new(Vec::new())),
            playback_alive: Arc::new(AtomicBool::new(false)),
            playback_thread: None,
            recorded_audio: Arc::new(Mutex::new(None)),
            input_gain: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
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
        let in_channels = default_config.channels();
        let config = StreamConfig {
            channels: in_channels,
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };
        let sr = config.sample_rate.0;

        println!("[audio_input] device config: {}Hz, {}ch, {:?}", sr, in_channels, sample_format);

        // Update sample rate and resize ring buffer
        {
            *self.sample_rate.lock().unwrap() = sr;
            let mut ring = self.ring.lock().unwrap();
            *ring = RingBuffer::new(sr as usize * 4);
        }

        let alive = self.alive.clone();
        alive.store(true, Ordering::SeqCst);
        let ring = self.ring.clone();
        let is_recording = self.is_recording.clone();
        let recording_buf = self.recording_buf.clone();
        let input_gain = self.input_gain.clone();
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
            let is_recording_cb = is_recording.clone();
            let recording_buf_cb = recording_buf.clone();
            let max_recording_samples = sample_rate as usize * 10; // 10 second max

            let stream_result = match sample_format {
                SampleFormat::F32 => {
                    let is_rec = is_recording_cb.clone();
                    let rec_buf = recording_buf_cb.clone();
                    let max_rec = max_recording_samples;
                    let gain = input_gain.clone();
                    device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let g = f32::from_bits(gain.load(Ordering::Relaxed));
                        let mono: Vec<f32> = data.chunks(channels).map(|f| f[0] * g).collect();
                        if let Ok(mut r) = ring_for_callback.try_lock() {
                            r.write(&mono);
                        }
                        if is_rec.load(Ordering::Relaxed) {
                            if let Ok(mut buf) = rec_buf.try_lock() {
                                if buf.len() < max_rec {
                                    buf.extend_from_slice(&mono);
                                }
                            }
                        }
                    },
                    |err| eprintln!("Audio input error: {}", err),
                    None,
                )},
                SampleFormat::I16 => {
                    let is_rec = is_recording_cb.clone();
                    let rec_buf = recording_buf_cb.clone();
                    let max_rec = max_recording_samples;
                    let gain = input_gain.clone();
                    device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let g = f32::from_bits(gain.load(Ordering::Relaxed));
                        let mono: Vec<f32> = data.chunks(channels)
                            .map(|f| (f[0] as f32 / i16::MAX as f32) * g)
                            .collect();
                        if let Ok(mut r) = ring_for_callback.try_lock() {
                            r.write(&mono);
                        }
                        if is_rec.load(Ordering::Relaxed) {
                            if let Ok(mut buf) = rec_buf.try_lock() {
                                if buf.len() < max_rec {
                                    buf.extend_from_slice(&mono);
                                }
                            }
                        }
                    },
                    |err| eprintln!("Audio input error: {}", err),
                    None,
                )},
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
        self.is_recording.store(false, Ordering::SeqCst);
        self.stop_playback();
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

    pub fn set_input_gain(&self, gain_linear: f32) {
        let clamped = gain_linear.clamp(0.0, 100.0); // 0 to +40dB ~ 100x
        println!("[audio_input] set_input_gain: {:.2}x ({:.1} dB)", clamped, 20.0 * clamped.log10());
        self.input_gain.store(clamped.to_bits(), Ordering::Relaxed);
    }

    // ─── Recording ──────────────────────────────────────────────────

    pub fn start_recording(&self) {
        self.is_recording.store(false, Ordering::SeqCst);
        {
            let mut buf = self.recording_buf.lock().unwrap();
            buf.clear();
            let sr = *self.sample_rate.lock().unwrap();
            buf.reserve(sr as usize * 10);
            println!("[recording] started, sample_rate={}Hz", sr);
        }
        self.is_recording.store(true, Ordering::SeqCst);
    }

    /// Stop recording and stash the buffer for playback. Returns duration in seconds.
    pub fn stop_recording(&mut self) -> f32 {
        self.is_recording.store(false, Ordering::SeqCst);
        let sr = *self.sample_rate.lock().unwrap();
        let samples: Vec<f32> = {
            let mut buf = self.recording_buf.lock().unwrap();
            std::mem::take(&mut *buf)
        };
        let duration = samples.len() as f32 / sr as f32;
        println!("[recording] stopped, {} samples, {:.2}s @ {}Hz", samples.len(), duration, sr);
        *self.recorded_audio.lock().unwrap() = Some((samples, sr));
        duration
    }

    pub fn has_recording(&self) -> bool {
        self.recorded_audio.lock().unwrap().is_some()
    }

    pub fn discard_recording(&mut self) {
        *self.recorded_audio.lock().unwrap() = None;
    }

    /// Get the waveform envelope (downsampled peaks) for UI display.
    pub fn get_waveform(&self, num_points: usize) -> Vec<f32> {
        let guard = self.recorded_audio.lock().unwrap();
        match &*guard {
            Some((samples, _)) if !samples.is_empty() => {
                let chunk_size = (samples.len() / num_points).max(1);
                samples.chunks(chunk_size)
                    .take(num_points)
                    .map(|chunk| {
                        chunk.iter().map(|s| s.abs()).fold(0.0_f32, f32::max)
                    })
                    .collect()
            }
            _ => vec![0.0; num_points],
        }
    }

    // ─── Playback ──────────────────────────────────────────────────

    pub fn start_playback(&mut self, app_handle: AppHandle, output_device_name: Option<&str>) -> Result<(), String> {
        self.stop_playback();

        let (samples, rec_sr) = {
            let guard = self.recorded_audio.lock().unwrap();
            match &*guard {
                Some((s, r)) => (s.clone(), *r),
                None => return Err("No recording to play".to_string()),
            }
        };

        let alive = Arc::new(AtomicBool::new(true));
        self.playback_alive = alive.clone();

        let device_name_owned = output_device_name.map(|s| s.to_string());

        self.playback_thread = Some(thread::spawn(move || {
            let host = cpal::default_host();
            let device = if let Some(name) = &device_name_owned {
                host.output_devices()
                    .ok()
                    .and_then(|mut devs| devs.find(|d| d.name().ok().as_deref() == Some(name.as_str())))
                    .or_else(|| host.default_output_device())
            } else {
                host.default_output_device()
            };
            let device = match device {
                Some(d) => d,
                None => {
                    eprintln!("Playback: no output device found");
                    let _ = app_handle.emit("playback-finished", ());
                    return;
                }
            };

            let default_config = match device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Playback: failed to get default output config: {}", e);
                    let _ = app_handle.emit("playback-finished", ());
                    return;
                }
            };

            let out_sr = default_config.sample_rate().0;
            let out_format = default_config.sample_format();
            // Force stereo for playback — some interfaces (e.g. Scarlett) report
            // multichannel in default_output_config but the actual stream delivers
            // stereo buffers, causing slow-mo when we divide by too many channels.
            let out_channels: usize = 2;

            println!("[playback] recording: {} samples @ {}Hz, output: {}Hz {}ch {:?} (device reports {}ch)",
                samples.len(), rec_sr, out_sr, out_channels, out_format, default_config.channels());

            let config = StreamConfig {
                channels: out_channels as u16,
                sample_rate: default_config.sample_rate(),
                buffer_size: cpal::BufferSize::Default,
            };

            // Resample if needed (linear interpolation)
            let playback_samples = if rec_sr != out_sr {
                let ratio = rec_sr as f64 / out_sr as f64;
                let out_len = (samples.len() as f64 / ratio).ceil() as usize;
                let mut resampled = Vec::with_capacity(out_len);
                for i in 0..out_len {
                    let src_pos = i as f64 * ratio;
                    let idx = src_pos as usize;
                    let frac = src_pos - idx as f64;
                    let s0 = samples.get(idx).copied().unwrap_or(0.0);
                    let s1 = samples.get(idx + 1).copied().unwrap_or(s0);
                    resampled.push(s0 + (s1 - s0) * frac as f32);
                }
                resampled
            } else {
                samples
            };

            let samples_arc = Arc::new(playback_samples);
            let samples_for_cb = samples_arc.clone();
            let total_len = samples_arc.len();
            let cursor = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let cursor_for_cb = cursor.clone();
            let alive_for_cb = alive.clone();
            let logged = Arc::new(AtomicBool::new(false));
            let logged_cb = logged.clone();

            let build_result = device.build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    if !alive_for_cb.load(Ordering::Relaxed) {
                        for s in data.iter_mut() { *s = 0.0; }
                        return;
                    }
                    if !logged_cb.swap(true, Ordering::Relaxed) {
                        println!("[playback] first callback: data.len()={}, out_channels={}, frames={}",
                            data.len(), out_channels, data.len() / out_channels);
                    }
                    let pos = cursor_for_cb.load(Ordering::Relaxed);
                    let frames = data.len() / out_channels;
                    for frame in 0..frames {
                        let idx = pos + frame;
                        let sample = if idx < total_len {
                            samples_for_cb[idx]
                        } else {
                            0.0
                        };
                        // Write mono sample to all output channels
                        for ch in 0..out_channels {
                            data[frame * out_channels + ch] = sample;
                        }
                    }
                    cursor_for_cb.store((pos + frames).min(total_len), Ordering::Relaxed);
                },
                |err| eprintln!("Playback error: {}", err),
                None,
            );

            // If stereo fails, try with the device's reported channel count
            let stream = match build_result {
                Ok(s) => s,
                Err(e) => {
                    let dev_channels = default_config.channels() as usize;
                    println!("[playback] stereo stream failed ({}), retrying with {}ch", e, dev_channels);
                    if dev_channels == out_channels {
                        eprintln!("Failed to build output stream for playback: {}", e);
                        let _ = app_handle.emit("playback-finished", ());
                        return;
                    }
                    let config2 = StreamConfig {
                        channels: default_config.channels(),
                        sample_rate: default_config.sample_rate(),
                        buffer_size: cpal::BufferSize::Default,
                    };
                    let samples_for_cb2 = samples_arc.clone();
                    let cursor_for_cb2 = cursor.clone();
                    let alive_for_cb2 = alive.clone();
                    match device.build_output_stream(
                        &config2,
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            if !alive_for_cb2.load(Ordering::Relaxed) {
                                for s in data.iter_mut() { *s = 0.0; }
                                return;
                            }
                            let pos = cursor_for_cb2.load(Ordering::Relaxed);
                            let frames = data.len() / dev_channels;
                            for frame in 0..frames {
                                let idx = pos + frame;
                                let sample = if idx < samples_for_cb2.len() {
                                    samples_for_cb2[idx]
                                } else {
                                    0.0
                                };
                                for ch in 0..dev_channels {
                                    data[frame * dev_channels + ch] = sample;
                                }
                            }
                            cursor_for_cb2.store((pos + frames).min(samples_for_cb2.len()), Ordering::Relaxed);
                        },
                        |err| eprintln!("Playback error: {}", err),
                        None,
                    ) {
                        Ok(s) => s,
                        Err(e2) => {
                            eprintln!("Failed to build output stream for playback (both attempts): {}", e2);
                            let _ = app_handle.emit("playback-finished", ());
                            return;
                        }
                    }
                }
            };

            if let Err(e) = stream.play() {
                eprintln!("Failed to start playback: {}", e);
                let _ = app_handle.emit("playback-finished", ());
                return;
            }

            // Wait for playback to finish or be stopped
            while alive.load(Ordering::SeqCst) {
                let pos = cursor.load(Ordering::Relaxed);
                if pos >= total_len {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }

            alive.store(false, Ordering::SeqCst);
            drop(stream);
            let _ = app_handle.emit("playback-finished", ());
        }));

        Ok(())
    }

    pub fn stop_playback(&mut self) {
        self.playback_alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.playback_thread.take() {
            let _ = handle.join();
        }
    }

    pub fn is_playing_back(&self) -> bool {
        self.playback_alive.load(Ordering::SeqCst)
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
