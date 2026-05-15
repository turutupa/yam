//! Practice Coach — LLM inference engine.
//!
//! When built with the `coach-llm` feature, loads a GGUF model from disk and
//! runs text generation for coaching comments, mini-reports, session summaries,
//! and chat Q&A. Without the feature, generates template-based responses.

use std::sync::{Arc, Mutex};

/// Thread-safe handle to the coach engine.
pub type SharedCoachEngine = Arc<Mutex<CoachEngine>>;

pub fn create_shared_engine() -> SharedCoachEngine {
    Arc::new(Mutex::new(CoachEngine::new()))
}

// ---------------------------------------------------------------------------
// Template-based engine (always available)
// ---------------------------------------------------------------------------

pub struct CoachEngine {
    #[cfg(feature = "coach-llm")]
    model: Option<LlmModel>,
    loaded: bool,
}

impl CoachEngine {
    pub fn new() -> Self {
        CoachEngine {
            #[cfg(feature = "coach-llm")]
            model: None,
            loaded: false,
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded
    }
}

/// System prompt that constrains the coach's behavior.
pub const SYSTEM_PROMPT: &str = r#"You are a practice coach for a metronome app. You help musicians improve their timing and rhythm.

Rules:
- Keep responses concise (1-3 sentences max)
- Only discuss timing, rhythm, practice, and the session data you're given
- Be encouraging but honest about areas to improve
- Never make up data — only reference metrics provided to you
- Use natural, conversational language like a supportive instructor
- When commenting on timing: "early" means ahead of the beat, "late" means behind
- Reference specific beats or patterns when the data supports it"#;

/// Load the GGUF model from the brain directory.
pub fn load_model(engine: &mut CoachEngine, model_path: &std::path::Path) -> Result<bool, String> {
    if !model_path.exists() {
        return Ok(false);
    }

    #[cfg(feature = "coach-llm")]
    {
        let llm = LlmModel::load(model_path)?;
        engine.model = Some(llm);
        engine.loaded = true;
        return Ok(true);
    }

    #[cfg(not(feature = "coach-llm"))]
    {
        // Mark as loaded so template-based mode activates
        let _ = model_path;
        engine.loaded = true;
        Ok(true)
    }
}

/// Generate a coaching comment from structured DSP data.
pub fn generate(engine: &CoachEngine, context: &str) -> Result<String, String> {
    #[cfg(feature = "coach-llm")]
    if let Some(ref model) = engine.model {
        return model.generate(context);
    }

    // Template-based fallback
    generate_template(context)
}

/// Template-based generation — parses the structured context and produces a response.
fn generate_template(context: &str) -> Result<String, String> {
    // Parse key metrics from the context string
    let accuracy = extract_metric(context, "Accuracy:").unwrap_or(0.0);
    let deviation = extract_metric(context, "avg").unwrap_or(0.0);
    let streak = extract_int(context, "Longest clean streak:").unwrap_or(0);

    let is_summary = context.contains("ended their practice session");
    let is_chat = context.contains("User asks:");

    if is_chat {
        // Extract the question
        let question = context
            .lines()
            .find(|l| l.starts_with("User asks:"))
            .map(|l| l.trim_start_matches("User asks:").trim())
            .unwrap_or("");

        return Ok(format_chat_response(question, accuracy, deviation));
    }

    if is_summary {
        return Ok(format_session_summary(accuracy, deviation, streak));
    }

    // Mini-report
    Ok(format_mini_report(accuracy, deviation, streak))
}

fn format_mini_report(accuracy: f64, deviation: f64, streak: u32) -> String {
    let timing = if deviation.abs() < 5.0 {
        "right in the pocket"
    } else if deviation < -5.0 {
        "slightly ahead of the beat"
    } else {
        "slightly behind the beat"
    };

    if accuracy >= 90.0 {
        if streak >= 16 {
            format!("Solid run — {accuracy:.0}% accuracy, {timing}. {streak}-beat clean streak, nice consistency.")
        } else {
            format!("Good accuracy at {accuracy:.0}%, {timing}. Keep pushing for longer clean streaks.")
        }
    } else if accuracy >= 70.0 {
        format!("Decent run at {accuracy:.0}% accuracy. You're {timing} — try locking in with the click a bit more.")
    } else {
        format!("{accuracy:.0}% accuracy this round. Slow it down a few BPM and focus on clean hits before pushing tempo.")
    }
}

fn format_session_summary(accuracy: f64, deviation: f64, streak: u32) -> String {
    let tendency = if deviation.abs() < 3.0 {
        "centered timing"
    } else if deviation < 0.0 {
        "a tendency to rush"
    } else {
        "a tendency to drag"
    };

    if accuracy >= 85.0 {
        format!(
            "Strong session — {accuracy:.0}% overall accuracy with {tendency}. \
             Best streak was {streak} beats. Next time, try bumping the tempo up a notch."
        )
    } else if accuracy >= 60.0 {
        format!(
            "Solid practice at {accuracy:.0}% accuracy with {tendency}. \
             Focus on the spots where you dropped off — consistency comes before speed."
        )
    } else {
        format!(
            "Tough session at {accuracy:.0}% accuracy. You had {tendency}. \
             Consider dropping 5-10 BPM next time and building accuracy first."
        )
    }
}

fn format_chat_response(question: &str, accuracy: f64, deviation: f64) -> String {
    let q = question.to_lowercase();
    if q.contains("timing") || q.contains("how was") || q.contains("how did") {
        let timing = if deviation.abs() < 5.0 {
            "Your timing was solid — pretty centered on the beat."
        } else if deviation < 0.0 {
            "You were pushing slightly ahead of the beat on average."
        } else {
            "You were sitting slightly behind the beat on average."
        };
        format!("{timing} Overall accuracy was {accuracy:.0}%.")
    } else if q.contains("focus") || q.contains("improve") || q.contains("work on") {
        if deviation.abs() > 10.0 {
            "Focus on locking in with the click — your timing is drifting. Try a slower tempo and nail the pocket.".to_string()
        } else if accuracy < 80.0 {
            "Work on clean hits at this tempo before pushing faster. Accuracy first, speed second.".to_string()
        } else {
            "You're in good shape. Try pushing the tempo up 5 BPM and see if you can maintain this accuracy.".to_string()
        }
    } else {
        format!("Your session shows {accuracy:.0}% accuracy with an average deviation of {deviation:.1}ms. Keep at it!")
    }
}

fn extract_metric(text: &str, prefix: &str) -> Option<f64> {
    text.lines()
        .find(|l| l.contains(prefix))
        .and_then(|l| {
            l.split_whitespace()
                .find_map(|w| w.trim_end_matches('%').parse::<f64>().ok())
        })
}

fn extract_int(text: &str, prefix: &str) -> Option<u32> {
    text.lines()
        .find(|l| l.contains(prefix))
        .and_then(|l| {
            let after = l.split(prefix).nth(1)?;
            after.split_whitespace()
                .next()?
                .parse::<u32>()
                .ok()
        })
}

/// Format a mini-report context for the model.
pub fn format_mini_report_context(
    bpm: u16,
    time_signature: u8,
    accuracy_pct: f64,
    mean_deviation_ms: f64,
    perfect_count: u32,
    good_count: u32,
    ok_count: u32,
    miss_count: u32,
    longest_streak: u32,
    grid_correlation: Option<f64>,
) -> String {
    let pocket = if mean_deviation_ms < -5.0 {
        "ahead of the beat (rushing)"
    } else if mean_deviation_ms > 5.0 {
        "behind the beat (dragging)"
    } else {
        "right on the beat"
    };

    let style = match grid_correlation {
        Some(gc) if gc > 0.8 => "structured exercise (high grid correlation)",
        Some(gc) if gc > 0.3 => "semi-structured playing",
        Some(_) => "free/improvised playing (low grid correlation)",
        None => "unknown playing style",
    };

    format!(
        "The player just finished a passage. Generate a brief coaching comment.\n\
         BPM: {bpm}, Time signature: {time_signature}/4\n\
         Playing style: {style}\n\
         Accuracy: {accuracy_pct:.0}% ({perfect_count} perfect, {good_count} good, {ok_count} ok, {miss_count} miss)\n\
         Timing tendency: {pocket} (avg {mean_deviation_ms:.1}ms)\n\
         Longest clean streak: {longest_streak} beats"
    )
}

/// Format an end-of-session context for the model.
pub fn format_session_summary_context(
    duration_secs: u64,
    segment_count: usize,
    overall_score: u32,
    grade: &str,
    total_beats: u32,
    accuracy_pct: f64,
    mean_deviation_ms: f64,
    longest_streak: u32,
) -> String {
    format!(
        "The player has ended their practice session. Generate a brief session summary.\n\
         Duration: {duration_secs} seconds, {segment_count} segment(s)\n\
         Overall score: {overall_score}/100 (grade {grade})\n\
         Total beats: {total_beats}, accuracy: {accuracy_pct:.0}%\n\
         Timing tendency: avg {mean_deviation_ms:.1}ms deviation\n\
         Longest clean streak: {longest_streak} beats\n\
         Keep it encouraging and suggest one specific thing to focus on next time."
    )
}

/// Format a chat context for Q&A.
pub fn format_chat_context(
    session_data: &str,
    preset_summary: Option<&str>,
    conversation: &[(String, String)],
    user_question: &str,
) -> String {
    let mut ctx = String::new();
    ctx.push_str("Current session data:\n");
    ctx.push_str(session_data);
    ctx.push('\n');

    if let Some(summary) = preset_summary {
        ctx.push_str("\nPreset history:\n");
        ctx.push_str(summary);
        ctx.push('\n');
    }

    if !conversation.is_empty() {
        ctx.push_str("\nConversation so far:\n");
        for (role, content) in conversation {
            ctx.push_str(&format!("{role}: {content}\n"));
        }
    }

    ctx.push_str(&format!("\nUser asks: {user_question}\n"));
    ctx.push_str("Answer concisely based only on the data above.");
    ctx
}

// ---------------------------------------------------------------------------
// LLM backend (only compiled with coach-llm feature)
// ---------------------------------------------------------------------------

#[cfg(feature = "coach-llm")]
mod llm {
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::LlamaModel;
    use llama_cpp_2::sampling::LlamaSampler;

    const MAX_TOKENS: usize = 256;
    const CONTEXT_SIZE: u32 = 2048;

    pub struct LlmModel {
        backend: LlamaBackend,
        model: LlamaModel,
    }

    impl LlmModel {
        pub fn load(path: &std::path::Path) -> Result<Self, String> {
            let backend = LlamaBackend::init()
                .map_err(|e| format!("Failed to init llama backend: {e}"))?;
            let params = LlamaModelParams::default();
            let model = LlamaModel::load_from_file(&backend, path, &params)
                .map_err(|e| format!("Failed to load model: {e}"))?;
            Ok(LlmModel { backend, model })
        }

        pub fn generate(&self, context: &str) -> Result<String, String> {
            let prompt = format!(
                "<|system|>\n{}<|end|>\n<|user|>\n{context}<|end|>\n<|assistant|>\n",
                super::SYSTEM_PROMPT,
            );

            let ctx_params = LlamaContextParams::default()
                .with_n_ctx(std::num::NonZero::new(CONTEXT_SIZE));
            let mut ctx = self.model.new_context(&self.backend, ctx_params)
                .map_err(|e| format!("Context creation failed: {e}"))?;

            let tokens = self.model
                .str_to_token(&prompt, llama_cpp_2::model::AddBos::Always)
                .map_err(|e| format!("Tokenization failed: {e}"))?;

            if tokens.len() >= CONTEXT_SIZE as usize {
                return Err("Prompt too long for context window".into());
            }

            let mut batch = LlamaBatch::new(CONTEXT_SIZE as usize, 1);
            for (i, &token) in tokens.iter().enumerate() {
                let is_last = i == tokens.len() - 1;
                batch.add(token, i as i32, &[0], is_last)
                    .map_err(|e| format!("Batch add failed: {e}"))?;
            }

            ctx.decode(&mut batch)
                .map_err(|e| format!("Decode failed: {e}"))?;

            let mut output_tokens = Vec::new();
            let mut sampler = LlamaSampler::chain_simple([
                LlamaSampler::temp(0.7),
                LlamaSampler::top_p(0.9, 1),
                LlamaSampler::dist(42),
            ]);

            for _ in 0..MAX_TOKENS {
                let logits_id = batch.n_tokens() - 1;
                let token = sampler.sample(&ctx, logits_id);

                if self.model.is_eog_token(token) {
                    break;
                }

                output_tokens.push(token);

                batch.clear();
                batch.add(
                    token,
                    tokens.len() as i32 + output_tokens.len() as i32 - 1,
                    &[0],
                    true,
                ).map_err(|e| format!("Batch add failed: {e}"))?;

                ctx.decode(&mut batch)
                    .map_err(|e| format!("Decode failed: {e}"))?;
            }

            let mut result = String::new();
            for token in &output_tokens {
                let piece = self.model
                    .token_to_str(*token, llama_cpp_2::token::LlamaTokenAttr::all())
                    .map_err(|e| format!("Token decode failed: {e}"))?;
                result.push_str(&piece);
            }

            Ok(result.trim().to_string())
        }
    }
}

#[cfg(feature = "coach-llm")]
use llm::LlmModel;
