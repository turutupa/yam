use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::onset::Onset;

/// A logged beat tick from the metronome engine.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BeatTick {
    /// Monotonic timestamp in nanoseconds (shared clock)
    #[serde(rename = "tsNs")]
    pub ts_ns: u64,
    /// Sequential beat index (0-based, resets each play session)
    #[serde(rename = "beatIndex")]
    pub beat_index: u32,
    /// Whether this is the first beat of a measure
    #[serde(rename = "isDownbeat")]
    pub is_downbeat: bool,
    /// Expected interval to next beat in ms (derived from current BPM)
    #[serde(rename = "expectedIntervalMs")]
    pub expected_interval_ms: f64,
}

/// Feedback for a single beat after matching with an onset.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BeatFeedback {
    /// Which beat this feedback is for
    #[serde(rename = "beatIndex")]
    pub beat_index: u32,
    /// Deviation from expected beat time in ms (negative = early, positive = late)
    #[serde(rename = "deviationMs")]
    pub deviation_ms: f64,
    /// Error in interval between this onset and previous onset (ms)
    #[serde(rename = "intervalErrorMs")]
    pub interval_error_ms: f64,
    /// Classification based on deviation
    pub classification: String,
    /// Amplitude of the matched onset (0.0 for miss)
    pub amplitude: f32,
    /// Current calibration offset in ms
    #[serde(rename = "calibrationOffsetMs")]
    pub calibration_offset_ms: f64,
    /// Confidence in calibration (0.0–1.0)
    #[serde(rename = "calibrationConfidence")]
    pub calibration_confidence: f64,
}

/// Shared beat log — engine writes, timing analyzer reads.
pub type BeatLog = Arc<Mutex<VecDeque<BeatTick>>>;

pub fn create_beat_log() -> BeatLog {
    Arc::new(Mutex::new(VecDeque::with_capacity(64)))
}

/// Timing analyzer that matches onsets to beat ticks and produces feedback.
pub struct TimingAnalyzer {
    alive: Arc<AtomicBool>,
    thread_handle: Option<thread::JoinHandle<()>>,
    onset_log: Arc<Mutex<VecDeque<Onset>>>,
    beat_log: BeatLog,
}

impl TimingAnalyzer {
    pub fn new(beat_log: BeatLog) -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
            onset_log: Arc::new(Mutex::new(VecDeque::with_capacity(64))),
            beat_log,
        }
    }

    /// Feed an onset into the analyzer (called from onset detector callback).
    pub fn log_onset(&self, onset: Onset) {
        let mut log = self.onset_log.lock().unwrap();
        log.push_back(onset);
        // Keep bounded
        while log.len() > 256 {
            log.pop_front();
        }
    }

    /// Start the analysis thread.
    pub fn start<F>(&mut self, on_feedback: F)
    where
        F: Fn(BeatFeedback) + Send + 'static,
    {
        self.stop();
        self.alive.store(true, Ordering::SeqCst);
        let alive = self.alive.clone();
        let onset_log = self.onset_log.clone();
        let beat_log = self.beat_log.clone();

        self.thread_handle = Some(thread::spawn(move || {
            Self::analysis_loop(alive, beat_log, onset_log, on_feedback);
        }));
    }

    pub fn stop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
        // Clear logs for next session
        self.onset_log.lock().unwrap().clear();
        self.beat_log.lock().unwrap().clear();
    }

    pub fn is_active(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn analysis_loop<F>(
        alive: Arc<AtomicBool>,
        beat_log: BeatLog,
        onset_log: Arc<Mutex<VecDeque<Onset>>>,
        on_feedback: F,
    ) where
        F: Fn(BeatFeedback) + Send + 'static,
    {
        // Auto-calibration: running median of raw offsets (onset_time - beat_time).
        // Absorbs fixed latency from audio hardware, OS buffering, etc.
        let calibration_window = 16;
        let mut calibration_offsets: VecDeque<f64> = VecDeque::with_capacity(calibration_window);
        let mut calibration_offset_ms: f64 = 0.0;

        // Track previous onset time for interval analysis
        let mut prev_onset_ns: Option<u64> = None;

        // Track which beat index we last processed
        let mut last_processed_beat: Option<u32> = None;

        // Tolerance window: ±200ms around expected beat
        let match_window_ns: u64 = 200_000_000;

        // Accumulate unmatched onsets between beat processing rounds
        let mut pending_onsets: Vec<Onset> = Vec::with_capacity(32);

        while alive.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
            if !alive.load(Ordering::SeqCst) {
                break;
            }

            // Drain new onsets into pending buffer
            {
                let mut log = onset_log.lock().unwrap();
                pending_onsets.extend(log.drain(..));
            }

            // Drain new beats
            let beats: Vec<BeatTick> = {
                let mut log = beat_log.lock().unwrap();
                log.drain(..).collect()
            };

            if beats.is_empty() {
                continue;
            }

            // Match each beat to the closest onset within the window
            for beat in &beats {
                // Skip if already processed
                if let Some(last) = last_processed_beat {
                    if beat.beat_index <= last {
                        continue;
                    }
                }
                last_processed_beat = Some(beat.beat_index);

                // The calibrated beat time: shift by the learned offset
                // so we compare onset times against where we expect the
                // player to actually hit (accounting for system latency).
                let calibrated_beat_ns = if calibration_offset_ms >= 0.0 {
                    beat.ts_ns.saturating_add((calibration_offset_ms * 1_000_000.0) as u64)
                } else {
                    beat.ts_ns.saturating_sub((-calibration_offset_ms * 1_000_000.0) as u64)
                };

                // Find closest onset to this calibrated beat time
                let mut best_idx: Option<usize> = None;
                let mut best_distance: u64 = u64::MAX;

                for (i, onset) in pending_onsets.iter().enumerate() {
                    let distance = if onset.ts_ns >= calibrated_beat_ns {
                        onset.ts_ns - calibrated_beat_ns
                    } else {
                        calibrated_beat_ns - onset.ts_ns
                    };

                    if distance < match_window_ns && distance < best_distance {
                        best_distance = distance;
                        best_idx = Some(i);
                    }
                }

                if let Some(idx) = best_idx {
                    let onset = pending_onsets.remove(idx);

                    // Raw offset (before calibration) for calibration update
                    let raw_offset_ms =
                        (onset.ts_ns as f64 - beat.ts_ns as f64) / 1_000_000.0;

                    // Update calibration with raw offset
                    calibration_offsets.push_back(raw_offset_ms);
                    while calibration_offsets.len() > calibration_window {
                        calibration_offsets.pop_front();
                    }
                    calibration_offset_ms = running_median(&calibration_offsets);

                    // Deviation after calibration (what the player feels)
                    let deviation_ms = raw_offset_ms - calibration_offset_ms;

                    // Interval error: compare actual inter-onset interval to expected
                    let interval_error_ms = if let Some(prev_ns) = prev_onset_ns {
                        let actual_interval_ms =
                            (onset.ts_ns as f64 - prev_ns as f64) / 1_000_000.0;
                        actual_interval_ms - beat.expected_interval_ms
                    } else {
                        0.0
                    };

                    prev_onset_ns = Some(onset.ts_ns);

                    // Classify
                    let abs_dev = deviation_ms.abs();
                    let classification = if abs_dev < 10.0 {
                        "perfect"
                    } else if abs_dev < 25.0 {
                        "good"
                    } else if abs_dev < 50.0 {
                        "ok"
                    } else {
                        "miss"
                    };

                    let confidence = (calibration_offsets.len() as f64
                        / calibration_window as f64)
                        .min(1.0);

                    on_feedback(BeatFeedback {
                        beat_index: beat.beat_index,
                        deviation_ms,
                        interval_error_ms,
                        classification: classification.to_string(),
                        amplitude: onset.amplitude,
                        calibration_offset_ms,
                        calibration_confidence: confidence,
                    });
                } else {
                    // No onset matched — this is a miss
                    prev_onset_ns = None;

                    let confidence = if calibration_offsets.is_empty() {
                        0.0
                    } else {
                        (calibration_offsets.len() as f64 / calibration_window as f64)
                            .min(1.0)
                    };

                    on_feedback(BeatFeedback {
                        beat_index: beat.beat_index,
                        deviation_ms: 0.0,
                        interval_error_ms: 0.0,
                        classification: "miss".to_string(),
                        amplitude: 0.0,
                        calibration_offset_ms,
                        calibration_confidence: confidence,
                    });
                }
            }

            // Prune old onsets that are too far in the past to match any future beat
            if let Some(latest_beat) = beats.last() {
                let cutoff = latest_beat.ts_ns.saturating_sub(match_window_ns);
                pending_onsets.retain(|o| o.ts_ns >= cutoff);
            }
        }
    }
}

impl Drop for TimingAnalyzer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Compute the median of a VecDeque<f64>.
fn running_median(values: &VecDeque<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = values.iter().copied().collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
}

pub type SharedTimingAnalyzer = Arc<Mutex<TimingAnalyzer>>;
