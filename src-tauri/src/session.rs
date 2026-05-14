use std::sync::{Arc, Mutex};

use crate::timing::BeatFeedback;

/// Accumulated session statistics from beat feedback events.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
    /// Number of skipped beats (warmup, idle, resting — not scored)
    #[serde(rename = "skippedBeats")]
    pub skipped_beats: u32,
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
    /// Human-readable one-liner comment based on performance
    pub comment: String,
    /// Specific insights about the session (early/late tendency, consistency, etc.)
    pub insights: Vec<String>,
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
        let mut skipped_beats = 0u32;
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
                "skipped" => {
                    skipped_beats += 1;
                    // Skipped beats don't break streaks or count as misses
                }
                _ => {
                    // "miss"
                    miss_count += 1;
                    if current_streak > longest_streak {
                        longest_streak = current_streak;
                    }
                    current_streak = 0;
                }
            }
            if fb.classification != "miss" && fb.classification != "skipped" && fb.interval_error_ms != 0.0 {
                interval_errors.push(fb.interval_error_ms.abs());
            }
        }
        if current_streak > longest_streak {
            longest_streak = current_streak;
        }

        let hits_count = perfect_count + good_count + ok_count;
        // Scored beats exclude skipped — only hits + misses count for scoring
        let scored_beats = hits_count + miss_count;

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
        // Use scored_beats (not total_beats) so skipped beats don't deflate hit rate
        let hit_rate = if scored_beats > 0 {
            hits_count as f64 / scored_beats as f64
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

        // Generate human-readable comment
        let comment = generate_comment(&grade, score, scored_beats);

        // Generate insights
        let insights = generate_insights(
            mean_deviation_ms,
            std_deviation_ms,
            longest_streak,
            hit_rate,
            score,
            scored_beats,
            perfect_count,
            hits_count,
            tempo_stability_ms,
        );

        SessionReport {
            total_beats,
            hits_count,
            miss_count,
            skipped_beats,
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
            comment,
            insights,
        }
    }
}

pub type SharedSessionAccumulator = Arc<Mutex<SessionAccumulator>>;

pub fn create_shared_session_accumulator() -> SharedSessionAccumulator {
    Arc::new(Mutex::new(SessionAccumulator::new()))
}

/// A persisted session with metadata for history.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SavedSession {
    pub id: String,
    pub timestamp: u64,
    pub bpm: u16,
    #[serde(rename = "timeSignature")]
    pub time_signature: u8,
    pub report: SessionReport,
}

pub const MAX_SESSION_HISTORY: usize = 30;

/// Generate a one-liner comment based on the grade and score.
fn generate_comment(grade: &str, score: u32, scored_beats: u32) -> String {
    if scored_beats < 8 {
        return "Not enough data yet — keep playing!".to_string();
    }
    match grade {
        "S" => match score {
            100 => "Flawless. You're a metronome yourself.",
            _ => "Outstanding timing — near-perfect precision.",
        },
        "A" => "Solid performance. Your timing is tight and consistent.",
        "B" => "Good work! A few rough edges, but strong overall.",
        "C" => "Decent foundation. Focus on evenness and you'll climb fast.",
        "D" => "Getting there. Slow down and lock in with the click.",
        _ => "Keep at it — consistent practice builds timing muscle memory.",
    }
    .to_string()
}

/// Generate specific, actionable insights from session data.
fn generate_insights(
    mean_deviation_ms: f64,
    std_deviation_ms: f64,
    longest_streak: u32,
    hit_rate: f64,
    score: u32,
    scored_beats: u32,
    perfect_count: u32,
    hits_count: u32,
    tempo_stability_ms: f64,
) -> Vec<String> {
    let mut insights = Vec::new();

    if scored_beats < 8 {
        return insights;
    }

    // Early/late tendency
    if mean_deviation_ms.abs() > 5.0 {
        if mean_deviation_ms < 0.0 {
            insights.push(format!(
                "You tend to rush — averaging {:.0}ms ahead of the beat.",
                mean_deviation_ms.abs()
            ));
        } else {
            insights.push(format!(
                "You tend to drag — averaging {:.0}ms behind the beat.",
                mean_deviation_ms
            ));
        }
    } else if hits_count > 8 {
        insights.push("Your timing is centered — no early/late bias.".to_string());
    }

    // Consistency praise or guidance
    if std_deviation_ms < 8.0 && hits_count > 12 {
        insights.push("Extremely consistent — your timing barely varies.".to_string());
    } else if std_deviation_ms > 25.0 {
        insights.push("Your timing varies quite a bit between beats. Try focusing on smaller phrases.".to_string());
    }

    // Streak highlight
    if longest_streak >= 16 {
        insights.push(format!(
            "Impressive streak of {} beats in a row without a miss!",
            longest_streak
        ));
    } else if longest_streak >= 8 {
        insights.push(format!(
            "Best streak: {} beats in a row. Build on that.",
            longest_streak
        ));
    }

    // High hit rate but low score = accuracy issue
    if hit_rate > 0.9 && score < 70 {
        insights.push("You're hitting most beats but not precisely — focus on locking in tighter.".to_string());
    }

    // Perfect ratio
    if hits_count > 0 {
        let perfect_ratio = perfect_count as f64 / hits_count as f64;
        if perfect_ratio > 0.6 && hits_count > 12 {
            insights.push(format!(
                "{:.0}% of your hits were perfect (<10ms). Keep it up!",
                perfect_ratio * 100.0
            ));
        }
    }

    // Tempo stability
    if tempo_stability_ms > 25.0 && hits_count > 8 {
        insights.push("Your spacing between beats is uneven. Try subdividing mentally to keep a steadier pulse.".to_string());
    } else if tempo_stability_ms < 5.0 && hits_count > 12 {
        insights.push("Rock-solid internal clock — your spacing between beats is very even.".to_string());
    }

    // Cap at 3 most relevant insights
    insights.truncate(3);
    insights
}
