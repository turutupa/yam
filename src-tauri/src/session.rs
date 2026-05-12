use std::sync::{Arc, Mutex};

use crate::timing::BeatFeedback;

/// Accumulated session statistics from beat feedback events.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionReport {
    /// Total beats in session
    #[serde(rename = "totalBeats")]
    pub total_beats: u32,
    /// Number of beats with a matched onset
    #[serde(rename = "hitsCount")]
    pub hits_count: u32,
    /// Number of missed beats
    #[serde(rename = "missCount")]
    pub miss_count: u32,
    /// Counts per classification
    #[serde(rename = "perfectCount")]
    pub perfect_count: u32,
    #[serde(rename = "goodCount")]
    pub good_count: u32,
    #[serde(rename = "okCount")]
    pub ok_count: u32,
    /// Mean deviation in ms (signed — negative = early tendency)
    #[serde(rename = "meanDeviationMs")]
    pub mean_deviation_ms: f64,
    /// Standard deviation of deviations (consistency measure)
    #[serde(rename = "stdDeviationMs")]
    pub std_deviation_ms: f64,
    /// Mean absolute deviation (how far off on average)
    #[serde(rename = "meanAbsDeviationMs")]
    pub mean_abs_deviation_ms: f64,
    /// Mean interval error (consistency between consecutive hits)
    #[serde(rename = "meanIntervalErrorMs")]
    pub mean_interval_error_ms: f64,
    /// Letter grade: S, A, B, C, D, F
    pub grade: String,
    /// Score 0–100
    pub score: u32,
    /// All deviations for histogram rendering
    pub deviations: Vec<f64>,
    /// Dynamics consistency: std deviation of hit amplitudes (lower = more even)
    #[serde(rename = "dynamicsStd")]
    pub dynamics_std: f64,
    /// Mean hit amplitude
    #[serde(rename = "meanAmplitude")]
    pub mean_amplitude: f64,
    /// Tempo stability: std deviation of interval errors (lower = steadier)
    #[serde(rename = "tempoStabilityMs")]
    pub tempo_stability_ms: f64,
    /// Longest streak of consecutive non-miss beats
    #[serde(rename = "longestStreak")]
    pub longest_streak: u32,
}

/// Accumulates BeatFeedback events during a playing session.
pub struct SessionAccumulator {
    feedbacks: Vec<BeatFeedback>,
}

impl SessionAccumulator {
    pub fn new() -> Self {
        Self {
            feedbacks: Vec::with_capacity(256),
        }
    }

    pub fn push(&mut self, fb: BeatFeedback) {
        self.feedbacks.push(fb);
    }

    pub fn clear(&mut self) {
        self.feedbacks.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.feedbacks.is_empty()
    }

    /// Generate a session report from accumulated feedback.
    pub fn report(&self) -> SessionReport {
        let total_beats = self.feedbacks.len() as u32;
        let mut perfect_count = 0u32;
        let mut good_count = 0u32;
        let mut ok_count = 0u32;
        let mut miss_count = 0u32;
        let mut deviations: Vec<f64> = Vec::new();
        let mut interval_errors: Vec<f64> = Vec::new();
        let mut amplitudes: Vec<f64> = Vec::new();

        // Track longest streak
        let mut longest_streak = 0u32;
        let mut current_streak = 0u32;

        for fb in &self.feedbacks {
            match fb.classification.as_str() {
                "perfect" => {
                    perfect_count += 1;
                    deviations.push(fb.deviation_ms);
                    amplitudes.push(fb.amplitude as f64);
                    current_streak += 1;
                }
                "good" => {
                    good_count += 1;
                    deviations.push(fb.deviation_ms);
                    amplitudes.push(fb.amplitude as f64);
                    current_streak += 1;
                }
                "ok" => {
                    ok_count += 1;
                    deviations.push(fb.deviation_ms);
                    amplitudes.push(fb.amplitude as f64);
                    current_streak += 1;
                }
                _ => {
                    miss_count += 1;
                    if current_streak > longest_streak {
                        longest_streak = current_streak;
                    }
                    current_streak = 0;
                }
            }
            if fb.classification != "miss" && fb.interval_error_ms != 0.0 {
                interval_errors.push(fb.interval_error_ms.abs());
            }
        }
        if current_streak > longest_streak {
            longest_streak = current_streak;
        }

        let hits_count = perfect_count + good_count + ok_count;

        let mean_deviation_ms = if deviations.is_empty() {
            0.0
        } else {
            deviations.iter().sum::<f64>() / deviations.len() as f64
        };

        let mean_abs_deviation_ms = if deviations.is_empty() {
            0.0
        } else {
            deviations.iter().map(|d| d.abs()).sum::<f64>() / deviations.len() as f64
        };

        let std_deviation_ms = if deviations.len() < 2 {
            0.0
        } else {
            let variance = deviations
                .iter()
                .map(|d| (d - mean_deviation_ms).powi(2))
                .sum::<f64>()
                / (deviations.len() - 1) as f64;
            variance.sqrt()
        };

        let mean_interval_error_ms = if interval_errors.is_empty() {
            0.0
        } else {
            interval_errors.iter().sum::<f64>() / interval_errors.len() as f64
        };

        // Dynamics consistency
        let mean_amplitude = if amplitudes.is_empty() {
            0.0
        } else {
            amplitudes.iter().sum::<f64>() / amplitudes.len() as f64
        };

        let dynamics_std = if amplitudes.len() < 2 {
            0.0
        } else {
            let var = amplitudes
                .iter()
                .map(|a| (a - mean_amplitude).powi(2))
                .sum::<f64>()
                / (amplitudes.len() - 1) as f64;
            var.sqrt()
        };

        // Tempo stability: std of interval errors
        let tempo_stability_ms = if interval_errors.len() < 2 {
            0.0
        } else {
            let mean_ie = interval_errors.iter().sum::<f64>() / interval_errors.len() as f64;
            let var = interval_errors
                .iter()
                .map(|e| (e - mean_ie).powi(2))
                .sum::<f64>()
                / (interval_errors.len() - 1) as f64;
            var.sqrt()
        };

        // Score: weighted combination of hit rate, accuracy, and consistency
        let hit_rate = if total_beats > 0 {
            hits_count as f64 / total_beats as f64
        } else {
            0.0
        };
        let accuracy_score = if deviations.is_empty() {
            0.0
        } else {
            let points = perfect_count as f64 * 10.0
                + good_count as f64 * 7.0
                + ok_count as f64 * 3.0;
            let max_points = hits_count as f64 * 10.0;
            if max_points > 0.0 { points / max_points } else { 0.0 }
        };
        let consistency_score = (1.0 - (std_deviation_ms / 50.0).min(1.0)).max(0.0);

        let raw_score = hit_rate * 0.3 + accuracy_score * 0.5 + consistency_score * 0.2;
        let score = (raw_score * 100.0).round() as u32;

        let grade = match score {
            95..=100 => "S",
            85..=94 => "A",
            70..=84 => "B",
            55..=69 => "C",
            40..=54 => "D",
            _ => "F",
        }
        .to_string();

        SessionReport {
            total_beats,
            hits_count,
            miss_count,
            perfect_count,
            good_count,
            ok_count,
            mean_deviation_ms,
            std_deviation_ms,
            mean_abs_deviation_ms,
            mean_interval_error_ms,
            grade,
            score,
            deviations,
            dynamics_std,
            mean_amplitude,
            tempo_stability_ms,
            longest_streak,
        }
    }
}

pub type SharedSessionAccumulator = Arc<Mutex<SessionAccumulator>>;

pub fn create_shared_session_accumulator() -> SharedSessionAccumulator {
    Arc::new(Mutex::new(SessionAccumulator::new()))
}
