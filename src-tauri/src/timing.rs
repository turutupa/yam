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
    /// Grid correlation score (0.0–1.0). Measures what fraction of recent
    /// onsets land near subdivision grid points.  High (>0.8) = structured
    /// exercise; low (<0.3) = free/improvisational playing.
    #[serde(rename = "gridCorrelation")]
    pub grid_correlation: f64,
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

        // ─── Grid correlation ──────────────────────────────────────
        // Track recent onset timestamps to measure alignment with the
        // subdivision grid.  We keep the last 64 onsets and compare each
        // against the nearest grid point (quarter, eighth, sixteenth, triplet).
        let mut grid_onset_times: VecDeque<u64> = VecDeque::with_capacity(64);
        let mut grid_correlation: f64 = 0.0;

        // ─── Activity state machine ─────────────────────────────────
        // Prevents unfair misses when user isn't playing yet or is resting
        #[derive(PartialEq)]
        enum Activity { Idle, Active, Resting }
        let mut activity = Activity::Idle;
        let mut consecutive_misses: u32 = 0;
        let mut grace_beats_remaining: u32 = 4; // warmup — never scored

        while alive.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
            if !alive.load(Ordering::SeqCst) {
                break;
            }

            // Drain new onsets into pending buffer
            {
                let mut log = onset_log.lock().unwrap();
                for onset in log.drain(..) {
                    // Record for grid correlation
                    grid_onset_times.push_back(onset.ts_ns);
                    while grid_onset_times.len() > 64 {
                        grid_onset_times.pop_front();
                    }
                    pending_onsets.push(onset);
                }
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

                // Grace period — first 4 beats are always skipped
                if grace_beats_remaining > 0 {
                    grace_beats_remaining -= 1;
                    on_feedback(BeatFeedback {
                        beat_index: beat.beat_index,
                        deviation_ms: 0.0,
                        interval_error_ms: 0.0,
                        classification: "skipped".to_string(),
                        amplitude: 0.0,
                        calibration_offset_ms,
                        calibration_confidence: 0.0,
                        grid_correlation,
                    });
                    continue;
                }

                // The calibrated beat time: shift by the learned offset
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

                    // Onset matched — transition to Active
                    activity = Activity::Active;
                    consecutive_misses = 0;

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
                    let confidence = (calibration_offsets.len() as f64
                        / calibration_window as f64)
                        .min(1.0);

                    let classification = if abs_dev < 10.0 {
                        "perfect"
                    } else if abs_dev < 25.0 {
                        "good"
                    } else if abs_dev < 50.0 {
                        "ok"
                    } else if confidence < 0.5 && abs_dev < 100.0 {
                        // Calibration still settling — be lenient
                        "ok"
                    } else {
                        "miss"
                    };

                    on_feedback(BeatFeedback {
                        beat_index: beat.beat_index,
                        deviation_ms,
                        interval_error_ms,
                        classification: classification.to_string(),
                        amplitude: onset.amplitude,
                        calibration_offset_ms,
                        calibration_confidence: confidence,
                        grid_correlation,
                    });
                } else {
                    // No onset matched — apply activity state machine
                    consecutive_misses += 1;

                    let confidence = if calibration_offsets.is_empty() {
                        0.0
                    } else {
                        (calibration_offsets.len() as f64 / calibration_window as f64)
                            .min(1.0)
                    };

                    // Determine if this should be scored or skipped
                    let classification = match activity {
                        Activity::Idle => {
                            // User hasn't started playing — don't penalize
                            "skipped"
                        }
                        Activity::Active => {
                            if consecutive_misses <= 2 {
                                // Brief pause — likely intentional rest
                                activity = Activity::Resting;
                                "skipped"
                            } else if consecutive_misses > 4 {
                                // Long silence — user stopped
                                activity = Activity::Idle;
                                prev_onset_ns = None;
                                "skipped"
                            } else {
                                // 3-4 consecutive misses while active — genuine misses
                                "miss"
                            }
                        }
                        Activity::Resting => {
                            if consecutive_misses > 4 {
                                // Rest turned into idle
                                activity = Activity::Idle;
                                prev_onset_ns = None;
                            }
                            "skipped"
                        }
                    };

                    on_feedback(BeatFeedback {
                        beat_index: beat.beat_index,
                        deviation_ms: 0.0,
                        interval_error_ms: 0.0,
                        classification: classification.to_string(),
                        amplitude: 0.0,
                        calibration_offset_ms,
                        calibration_confidence: confidence,
                        grid_correlation,
                    });
                }
            }

            // ─── Update grid correlation ────────────────────────────
            // Use the most recent beat's interval to define the grid.
            // Check each recent onset against the subdivision grid
            // (1, 2, 3, 4, 6 subdivisions of the beat interval).
            if let Some(latest_beat) = beats.last() {
                let interval_ns = (latest_beat.expected_interval_ms * 1_000_000.0) as u64;
                if interval_ns > 0 && grid_onset_times.len() >= 4 {
                    grid_correlation = compute_grid_correlation(
                        &grid_onset_times,
                        latest_beat.ts_ns,
                        interval_ns,
                        calibration_offset_ms,
                    );
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

/// Compute grid correlation: what fraction of recent onsets land near
/// subdivision grid points (quarter, eighth, triplet, sixteenth).
///
/// Returns 0.0–1.0.  High values mean the player is following the grid
/// closely (exercise/drill); low values mean free/improvised playing.
fn compute_grid_correlation(
    onset_times: &VecDeque<u64>,
    reference_beat_ns: u64,
    beat_interval_ns: u64,
    calibration_offset_ms: f64,
) -> f64 {
    if onset_times.len() < 4 || beat_interval_ns == 0 {
        return 0.0;
    }

    let cal_ns = (calibration_offset_ms * 1_000_000.0) as i64;

    // Subdivision divisors: 1 (quarter), 2 (eighth), 3 (triplet), 4 (16th), 6 (sextuplet)
    let divisors: &[u64] = &[1, 2, 3, 4, 6];

    // Tolerance: 15% of the smallest subdivision grid interval (sixteenth)
    let smallest_grid = beat_interval_ns / 6;
    let tolerance_ns = smallest_grid * 15 / 100; // 15%
    let tolerance_ns = tolerance_ns.max(5_000_000); // at least 5ms

    let mut on_grid_count: usize = 0;

    for &onset_ns in onset_times.iter() {
        // Apply calibration offset
        let adjusted_ns = onset_ns as i64 - cal_ns;
        // Distance from reference beat
        let diff = adjusted_ns - reference_beat_ns as i64;
        // We only care about the phase, not the absolute position
        let interval = beat_interval_ns as i64;

        // Find the phase within one beat interval (always positive via modulo)
        let phase = ((diff % interval) + interval) % interval;

        // Check if phase is near any subdivision grid point
        let mut best_distance = i64::MAX;
        for &d in divisors {
            let grid_step = interval / d as i64;
            if grid_step == 0 {
                continue;
            }
            // Nearest grid point for this subdivision
            let grid_phase = ((phase + grid_step / 2) / grid_step) * grid_step;
            let dist = (phase - grid_phase).abs();
            // Also check wrapping around beat boundary
            let dist_wrap = (phase - (grid_phase - interval)).abs().min(
                (phase - (grid_phase + interval)).abs(),
            );
            let min_dist = dist.min(dist_wrap);
            if min_dist < best_distance {
                best_distance = min_dist;
            }
        }

        if best_distance <= tolerance_ns as i64 {
            on_grid_count += 1;
        }
    }

    on_grid_count as f64 / onset_times.len() as f64
}

pub type SharedTimingAnalyzer = Arc<Mutex<TimingAnalyzer>>;
