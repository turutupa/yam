use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub bpm: u16,
    #[serde(rename = "isPlaying")]
    pub is_playing: bool,
    pub subdivision: u8,
    pub mode: String,
    pub corner: String,
    #[serde(rename = "alwaysOnTop")]
    pub always_on_top: bool,
    #[serde(rename = "accentColor")]
    pub accent_color: String,
    pub volume: f32,
    #[serde(rename = "soundType")]
    pub sound_type: String,
    #[serde(rename = "timeSignature")]
    pub time_signature: u8,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            bpm: 120,
            is_playing: false,
            subdivision: 1,
            mode: "comfortable".to_string(),
            corner: "top-right".to_string(),
            always_on_top: true,
            accent_color: "#e94560".to_string(),
            volume: 0.8,
            sound_type: "click".to_string(),
            time_signature: 4,
        }
    }
}

pub type SharedState = Arc<Mutex<AppState>>;

pub fn create_shared_state() -> SharedState {
    Arc::new(Mutex::new(AppState::default()))
}
