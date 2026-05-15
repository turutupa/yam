use crate::audio_input::{AudioDevice, SharedAudioInput};
use crate::coach::SharedCoachEngine;
use crate::engine::MetronomeEngine;
use crate::midi::{MidiBinding, MidiDeviceInfo, MidiMsgType, SharedMidi};
use crate::onset::SharedOnsetDetector;
use crate::session::{SessionReport, SharedSessionAccumulator};
use crate::state::{AppState, SharedState};
use crate::timing::SharedTimingAnalyzer;
use crate::tts::SharedTts;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct EngineState(pub Mutex<MetronomeEngine>);

/// Persist the current AppState to the store (minus is_playing which is transient).
fn persist_state(state: &SharedState, app_handle: &AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        let s = state.lock().unwrap();
        store.set("bpm", serde_json::json!(s.bpm));
        store.set("subdivision", serde_json::json!(s.subdivision));
        store.set("mode", serde_json::json!(s.mode));
        store.set("corner", serde_json::json!(s.corner));
        store.set("alwaysOnTop", serde_json::json!(s.always_on_top));
        store.set("widgetAlwaysOnTop", serde_json::json!(s.widget_always_on_top));
        store.set("accentColor", serde_json::json!(s.accent_color));
        store.set("theme", serde_json::json!(s.theme));
        store.set("volume", serde_json::json!(s.volume));
        store.set("soundType", serde_json::json!(s.sound_type));
        store.set("timeSignature", serde_json::json!(s.time_signature));
        store.set("speedRamp", serde_json::json!({
            "startBpm": s.speed_ramp.start_bpm,
            "targetBpm": s.speed_ramp.target_bpm,
            "increment": s.speed_ramp.increment,
            "decrement": s.speed_ramp.decrement,
            "barsPerStep": s.speed_ramp.bars_per_step,
            "beatsPerBar": s.speed_ramp.beats_per_bar,
            "mode": s.speed_ramp.mode,
            "cyclic": s.speed_ramp.cyclic,
        }));
    }
}

#[tauri::command]
pub fn get_state(state: State<SharedState>) -> AppState {
    state.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_bpm(bpm: u16, state: State<SharedState>, app_handle: AppHandle) {
    let clamped = bpm.clamp(20, 300);
    {
        let mut s = state.lock().unwrap();
        s.bpm = clamped;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_subdivision(subdivision: u8, state: State<SharedState>, app_handle: AppHandle) {
    let valid = subdivision.clamp(1, 6);
    {
        let mut s = state.lock().unwrap();
        s.subdivision = valid;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn toggle_playback(
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    let is_playing = {
        let s = state.lock().unwrap();
        s.is_playing
    };

    let mut engine = engine_state.0.lock().unwrap();

    if is_playing {
        engine.stop();
        let mut s = state.lock().unwrap();
        s.is_playing = false;
    } else {
        engine.start(state.inner().clone(), app_handle.clone());
        let mut s = state.lock().unwrap();
        s.is_playing = true;
    }

    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
}

#[tauri::command]
pub fn set_playing(
    playing: bool,
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    let mut engine = engine_state.0.lock().unwrap();

    if playing && !engine.is_running() {
        engine.start(state.inner().clone(), app_handle.clone());
        let mut s = state.lock().unwrap();
        s.is_playing = true;
    } else if !playing && engine.is_running() {
        engine.stop();
        let mut s = state.lock().unwrap();
        s.is_playing = false;
    }

    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
}

#[tauri::command]
pub fn set_widget_mode(mode: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.mode = mode;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_always_on_top(enabled: bool, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.always_on_top = enabled;
    }
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.set_always_on_top(enabled);
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_widget_always_on_top(enabled: bool, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.widget_always_on_top = enabled;
    }
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.set_always_on_top(enabled);
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn show_main(app_handle: AppHandle, state: State<SharedState>) {
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.hide();
    }
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let aot = state.lock().unwrap().always_on_top;
        let _ = main_win.set_always_on_top(aot);
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("lastWindow", serde_json::json!("main"));
    }
}

#[tauri::command]
pub fn show_floating(app_handle: AppHandle) {
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.hide();
    }
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.show();
    }
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("lastWindow", serde_json::json!("floating"));
    }
}

#[tauri::command]
pub fn set_theme(theme: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.theme = theme;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_volume(volume: f32, state: State<SharedState>, app_handle: AppHandle) {
    let clamped = volume.clamp(0.0, 1.0);
    {
        let mut s = state.lock().unwrap();
        s.volume = clamped;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn save_window_position(label: String, x: i32, y: i32, app_handle: AppHandle) {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").unwrap();
    let key = format!("window_position_{}", label);
    store.set(key, serde_json::json!({ "x": x, "y": y }));
}

#[tauri::command]
pub fn set_sound_type(sound_type: String, state: State<SharedState>, app_handle: AppHandle) {
    let valid = match sound_type.as_str() {
        "click" | "wood" | "beep" | "drum" => sound_type,
        _ => "click".to_string(),
    };
    {
        let mut s = state.lock().unwrap();
        s.sound_type = valid;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_time_signature(time_signature: u8, state: State<SharedState>, app_handle: AppHandle) {
    let valid = match time_signature {
        0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 => time_signature,
        _ => 4,
    };
    {
        let mut s = state.lock().unwrap();
        s.time_signature = valid;
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn configure_speed_ramp(
    start_bpm: u16,
    target_bpm: u16,
    increment: u16,
    decrement: u16,
    bars_per_step: u8,
    beats_per_bar: u8,
    mode: String,
    cyclic: bool,
    warmup_beats: u8,
    aggressiveness: Option<String>,
    state: State<SharedState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.start_bpm = start_bpm.clamp(20, 300);
        s.speed_ramp.target_bpm = target_bpm.clamp(s.speed_ramp.start_bpm, 300);
        s.speed_ramp.increment = increment.clamp(1, 50);
        s.speed_ramp.decrement = decrement.clamp(1, 50);
        s.speed_ramp.bars_per_step = bars_per_step.clamp(1, 32);
        s.speed_ramp.beats_per_bar = beats_per_bar.clamp(1, 12);
        s.speed_ramp.mode = match mode.as_str() {
            "linear" | "zigzag" | "adaptive" => mode,
            _ => "linear".to_string(),
        };
        s.speed_ramp.cyclic = cyclic;
        s.speed_ramp.warmup_beats = warmup_beats.clamp(0, 8);
        s.speed_ramp.aggressiveness = match aggressiveness.as_deref() {
            Some("conservative") => "conservative".to_string(),
            Some("aggressive") => "aggressive".to_string(),
            _ => "moderate".to_string(),
        };
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn start_speed_ramp(
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.active = true;
        s.speed_ramp.current_step = 0;
        s.speed_ramp.current_bpm = s.speed_ramp.start_bpm;
        s.speed_ramp.direction = "up".to_string();
        s.speed_ramp.bars_in_step = 0;
        s.speed_ramp.completed = false;
        s.speed_ramp.warmup_count = 0;
        // Don't touch s.bpm — ramp uses its own current_bpm
        s.is_playing = true;
    }
    {
        let mut engine = engine_state.0.lock().unwrap();
        engine.start(state.inner().clone(), app_handle.clone());
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
}

#[tauri::command]
pub fn start_speed_ramp_from(
    step: u16,
    bpm: u16,
    bar: u8,
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.active = true;
        s.speed_ramp.current_step = step;
        s.speed_ramp.current_bpm = bpm.clamp(20, 300);
        s.speed_ramp.direction = if bpm >= s.speed_ramp.target_bpm { "down".to_string() } else { "up".to_string() };
        s.speed_ramp.bars_in_step = bar;
        s.speed_ramp.completed = false;
        s.speed_ramp.warmup_count = 0;
        // Don't touch s.bpm — ramp uses its own current_bpm
        s.is_playing = true;
    }
    {
        let mut engine = engine_state.0.lock().unwrap();
        engine.start(state.inner().clone(), app_handle.clone());
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
}

#[tauri::command]
pub fn stop_speed_ramp(
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.active = false;
        s.is_playing = false;
    }
    {
        let mut engine = engine_state.0.lock().unwrap();
        engine.stop();
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
}

#[tauri::command]
pub fn set_adaptive_decision(
    decision: String,
    engine_state: State<EngineState>,
) {
    use crate::engine::{DECISION_UP, DECISION_HOLD, DECISION_DOWN};
    let val = match decision.as_str() {
        "up" => DECISION_UP,
        "hold" => DECISION_HOLD,
        "down" => DECISION_DOWN,
        _ => return,
    };
    let engine = engine_state.0.lock().unwrap();
    engine.adaptive_model_decision().store(val, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub fn set_active_tab(tab: String, app_handle: AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("activeTab", serde_json::json!(tab));
    }
}

#[tauri::command]
pub fn get_active_tab(app_handle: AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        if let Some(v) = store.get("activeTab").and_then(|v| v.as_str().map(String::from)) {
            return v;
        }
    }
    "beat".to_string()
}

#[tauri::command]
pub fn set_calibration_offset(offset: f64, app_handle: AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("calibrationOffset", serde_json::json!(offset));
    }
}

#[tauri::command]
pub fn get_calibration_offset(app_handle: AppHandle) -> Option<f64> {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        if let Some(v) = store.get("calibrationOffset").and_then(|v| v.as_f64()) {
            return Some(v);
        }
    }
    None
}

#[tauri::command]
pub fn open_url(url: String) {
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(&url).spawn(); }
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&url).spawn(); }
}

// ---------------------------------------------------------------------------
// MIDI Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_midi_devices(midi: State<SharedMidi>) -> Vec<MidiDeviceInfo> {
    let listener = midi.lock().unwrap();
    listener.list_devices()
}

#[tauri::command]
pub fn connect_midi_device(
    device_name: String,
    midi: State<SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let listener = midi.lock().unwrap();
    listener.connect(&device_name, app_handle.clone())?;
    // Persist connected device
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("midiDevice", serde_json::json!(device_name));
    }
    Ok(())
}

#[tauri::command]
pub fn disconnect_midi_device(midi: State<SharedMidi>, app_handle: AppHandle) -> Result<(), String> {
    let listener = midi.lock().unwrap();
    listener.disconnect();
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.delete("midiDevice");
    }
    Ok(())
}

#[tauri::command]
pub fn set_midi_binding(
    action: String,
    channel: Option<u8>,
    msg_type: String,
    number: u8,
    midi: State<SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mt = match msg_type.as_str() {
        "cc" => MidiMsgType::ControlChange,
        "note" => MidiMsgType::NoteOn,
        "pc" => MidiMsgType::ProgramChange,
        _ => return Err("Invalid msg_type: must be 'cc', 'note', or 'pc'".to_string()),
    };
    let binding = MidiBinding {
        action,
        channel,
        msg_type: mt,
        number,
    };
    let listener = midi.lock().unwrap();
    listener.add_binding(binding);
    // Persist bindings
    persist_midi_bindings(&listener, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn clear_midi_binding(
    action: String,
    midi: State<SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let listener = midi.lock().unwrap();
    listener.remove_binding(&action);
    persist_midi_bindings(&listener, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn get_midi_bindings(midi: State<SharedMidi>) -> Vec<MidiBinding> {
    let listener = midi.lock().unwrap();
    listener.get_bindings()
}

fn persist_midi_bindings(listener: &crate::midi::MidiListener, app_handle: &AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        let bindings = listener.get_bindings();
        store.set("midiBindings", serde_json::json!(bindings));
    }
}

// ---------------------------------------------------------------------------
// Preset Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_presets(app_handle: AppHandle) -> Vec<serde_json::Value> {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        if let Some(val) = store.get("presets") {
            if let Some(arr) = val.as_array() {
                return arr.clone();
            }
        }
    }
    Vec::new()
}

#[tauri::command]
pub fn save_preset(preset: serde_json::Value, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let id = preset.get("id").and_then(|v| v.as_str()).ok_or("preset must have an id")?;
    let mut presets: Vec<serde_json::Value> = store
        .get("presets")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    // Update existing or append new
    if let Some(pos) = presets.iter().position(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)) {
        presets[pos] = preset;
    } else {
        presets.push(preset);
    }

    store.set("presets", serde_json::json!(presets));
    Ok(())
}

#[tauri::command]
pub fn delete_preset(id: String, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let mut presets: Vec<serde_json::Value> = store
        .get("presets")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    presets.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(&id));
    store.set("presets", serde_json::json!(presets));
    Ok(())
}

#[tauri::command]
pub fn reorder_presets(ids: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let presets: Vec<serde_json::Value> = store
        .get("presets")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let mut reordered: Vec<serde_json::Value> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(p) = presets.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)) {
            reordered.push(p.clone());
        }
    }
    store.set("presets", serde_json::json!(reordered));
    Ok(())
}

// ---------------------------------------------------------------------------
// Audio Input / Evaluation Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_audio_input_devices() -> Vec<AudioDevice> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::audio_input::AudioInput::list_devices()
    }).await.unwrap_or_default()
}

#[tauri::command]
pub async fn start_evaluation(
    device_name: Option<String>,
    audio_input: State<'_, SharedAudioInput>,
    onset_detector: State<'_, SharedOnsetDetector>,
    timing_analyzer: State<'_, SharedTimingAnalyzer>,
    session_acc: State<'_, SharedSessionAccumulator>,
    engine_state: State<'_, EngineState>,
    midi: State<'_, SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Stop any existing evaluation first (idempotent — prevents deadlock if called twice)
    {
        let listener = midi.lock().unwrap();
        listener.clear_onset_callback();
    }
    onset_detector.lock().unwrap().stop();
    timing_analyzer.lock().unwrap().stop();

    let mut ai = audio_input.lock().unwrap();
    ai.start(device_name.as_deref(), app_handle.clone())?;

    // Clear previous session data
    session_acc.lock().unwrap().clear();

    // Get adaptive score handle from engine for real-time accuracy updates
    let adaptive_score = {
        let engine = engine_state.0.lock().unwrap();
        engine.adaptive_score()
    };

    // Start timing analyzer — emits beat-feedback events and accumulates session data
    let app_for_timing = app_handle.clone();
    let session_for_timing = session_acc.inner().clone();
    // Rolling window for adaptive score: track last N classifications
    let recent_hits = std::sync::Arc::new(std::sync::Mutex::new(Vec::<bool>::with_capacity(32)));
    let recent_hits_for_timing = recent_hits.clone();
    let adaptive_score_for_timing = adaptive_score;
    let mut ta = timing_analyzer.lock().unwrap();
    ta.start(move |feedback| {
        let _ = app_for_timing.emit("beat-feedback", &feedback);
        // Accumulate for session report
        if let Ok(mut acc) = session_for_timing.lock() {
            acc.push(feedback.clone());
        }
        // Update adaptive score (rolling window of last 16 beats)
        if feedback.classification != "skipped" {
            if let Ok(mut hits) = recent_hits_for_timing.lock() {
                hits.push(feedback.classification != "miss");
                if hits.len() > 16 {
                    hits.remove(0);
                }
                let total = hits.len() as u32;
                let hit_count = hits.iter().filter(|&&h| h).count() as u32;
                let score = if total > 0 { (hit_count * 100) / total } else { 0 };
                adaptive_score_for_timing.store(score, std::sync::atomic::Ordering::Relaxed);
            }
        }
    });

    // Start onset detection, forwarding onsets to both Tauri events AND timing analyzer
    let ai_shared = audio_input.inner().clone();
    let app_for_onset = app_handle.clone();
    let ta_shared = timing_analyzer.inner().clone();
    let mut od = onset_detector.lock().unwrap();
    od.start(ai_shared, move |onset| {
        let _ = app_for_onset.emit("onset-detected", &onset);
        // Feed into timing analyzer for beat matching
        if let Ok(ta) = ta_shared.lock() {
            ta.log_onset(onset);
        }
    });

    // Set MIDI onset callback — forward NoteOn events as onsets for timing
    let ta_for_midi = timing_analyzer.inner().clone();
    let app_for_midi = app_handle.clone();
    {
        let listener = midi.lock().unwrap();
        listener.set_onset_callback(move |velocity| {
            let onset = crate::onset::Onset {
                ts_ns: crate::clock::now_ns(),
                amplitude: velocity as f32 / 127.0,
                centroid: 0.0, // no spectral info from MIDI
            };
            let _ = app_for_midi.emit("onset-detected", &onset);
            if let Ok(ta) = ta_for_midi.lock() {
                ta.log_onset(onset);
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_evaluation(
    audio_input: State<'_, SharedAudioInput>,
    onset_detector: State<'_, SharedOnsetDetector>,
    timing_analyzer: State<'_, SharedTimingAnalyzer>,
    midi: State<'_, SharedMidi>,
) -> Result<(), String> {
    // Clear MIDI onset callback first (no lock ordering issue)
    {
        let listener = midi.lock().map_err(|e| format!("Lock failed: {e}"))?;
        listener.clear_onset_callback();
    }
    // Stop in reverse-start order: onset_detector → timing_analyzer → audio_input
    // This matches start_evaluation's lock acquisition order to prevent deadlocks
    onset_detector.lock().map_err(|e| format!("Lock failed: {e}"))?.stop();
    timing_analyzer.lock().map_err(|e| format!("Lock failed: {e}"))?.stop();
    audio_input.lock().map_err(|e| format!("Lock failed: {e}"))?.stop();
    Ok(())
}

#[tauri::command]
pub fn get_evaluation_state(audio_input: State<SharedAudioInput>) -> bool {
    let ai = audio_input.lock().unwrap();
    ai.is_active()
}

#[tauri::command]
pub async fn get_session_report(session_acc: State<'_, SharedSessionAccumulator>) -> Result<Option<SessionReport>, String> {
    let acc = session_acc.lock().map_err(|e| format!("Lock failed: {e}"))?;
    if acc.is_empty() {
        Ok(None)
    } else {
        Ok(Some(acc.report()))
    }
}

#[tauri::command]
pub async fn clear_session(session_acc: State<'_, SharedSessionAccumulator>) -> Result<(), String> {
    session_acc.lock().map_err(|e| format!("Lock failed: {e}"))?.clear();
    Ok(())
}

#[tauri::command]
pub fn save_session(session: crate::session::SavedSession, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let mut history: Vec<crate::session::SavedSession> = store
        .get("evalSessionHistory")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    // Prepend new session at the front
    history.insert(0, session);
    // Cap at max
    history.truncate(crate::session::MAX_SESSION_HISTORY);
    store.set("evalSessionHistory", serde_json::to_value(&history).unwrap());
    Ok(())
}

#[tauri::command]
pub fn get_session_history(app_handle: AppHandle) -> Vec<crate::session::SavedSession> {
    use tauri_plugin_store::StoreExt;
    app_handle
        .store("settings.json")
        .ok()
        .and_then(|store| {
            store
                .get("evalSessionHistory")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn delete_session(id: String, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let mut history: Vec<crate::session::SavedSession> = store
        .get("evalSessionHistory")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    history.retain(|s| s.id != id);
    store.set("evalSessionHistory", serde_json::to_value(&history).unwrap());
    Ok(())
}

#[tauri::command]
pub fn clear_all_sessions(app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let empty: Vec<crate::session::SavedSession> = Vec::new();
    store.set("evalSessionHistory", serde_json::to_value(&empty).unwrap());
    Ok(())
}

// ---------------------------------------------------------------------------
// Audio Input Recording / Playback
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn start_recording(audio_input: State<SharedAudioInput>) -> Result<(), String> {
    let ai = audio_input.lock().unwrap();
    if !ai.is_active() {
        return Err("Audio input is not active".to_string());
    }
    ai.start_recording();
    Ok(())
}

#[tauri::command]
pub fn stop_recording(audio_input: State<SharedAudioInput>) -> f32 {
    let mut ai = audio_input.lock().unwrap();
    ai.stop_recording()
}

#[tauri::command]
pub fn start_playback(
    audio_input: State<SharedAudioInput>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Use the same output device as the metronome engine
    let output_device_name = {
        let engine = engine_state.0.lock().unwrap();
        engine.device_name().map(|s| s.to_string())
    };
    let mut ai = audio_input.lock().unwrap();
    ai.start_playback(app_handle, output_device_name.as_deref())
}

#[tauri::command]
pub fn stop_playback(audio_input: State<SharedAudioInput>) {
    let mut ai = audio_input.lock().unwrap();
    ai.stop_playback();
}

#[tauri::command]
pub fn discard_recording(audio_input: State<SharedAudioInput>) {
    let mut ai = audio_input.lock().unwrap();
    ai.discard_recording();
}

#[tauri::command]
pub fn get_waveform(audio_input: State<SharedAudioInput>) -> Vec<f32> {
    let ai = audio_input.lock().unwrap();
    ai.get_waveform(100)
}

#[tauri::command]
pub fn set_input_gain(gain_db: f32, audio_input: State<SharedAudioInput>) {
    let gain_linear = 10.0_f32.powf(gain_db / 20.0);
    let ai = audio_input.lock().unwrap();
    ai.set_input_gain(gain_linear);
}

use crate::engine::AudioOutputDevice;

#[tauri::command]
pub fn list_audio_output_devices() -> Vec<AudioOutputDevice> {
    crate::engine::list_output_devices()
}

#[tauri::command]
pub fn set_audio_output_device(
    device_name: Option<String>,
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    // Persist the choice
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        match &device_name {
            Some(name) => store.set("audioOutputDevice", serde_json::json!(name)),
            None => store.set("audioOutputDevice", serde_json::Value::Null),
        }
    }

    let mut engine = engine_state.0.lock().unwrap();
    engine.set_device(device_name, state.inner().clone(), app_handle);
}

// ---------------------------------------------------------------------------
// Model download management
// ---------------------------------------------------------------------------

use crate::models;

pub struct DownloadState(pub std::sync::Mutex<Option<models::DownloadCancelFlag>>);

#[tauri::command]
pub fn get_model_status(app_handle: AppHandle) -> Result<models::ModelStatus, String> {
    models::check_model_status(&app_handle)
}

#[tauri::command]
pub fn write_model_chunk(
    app_handle: AppHandle,
    component: String,
    filename: String,
    data: Vec<u8>,
) -> Result<String, String> {
    models::write_model_file(&app_handle, &component, &filename, &data)
}

#[tauri::command]
pub fn get_models_path(app_handle: AppHandle) -> Result<String, String> {
    models::get_models_path(&app_handle)
}

#[tauri::command]
pub fn delete_models(app_handle: AppHandle) -> Result<(), String> {
    models::delete_models(&app_handle)
}

#[tauri::command]
pub fn start_model_download(
    app_handle: AppHandle,
    url: String,
    component: String,
    filename: String,
    tier: String,
    dl_state: State<DownloadState>,
) -> Result<(), String> {
    let mut guard = dl_state.0.lock().unwrap();
    // Cancel any existing download first
    if let Some(old) = guard.take() {
        old.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    *guard = Some(cancel.clone());
    models::start_download(app_handle, url, component, filename, tier, cancel);
    Ok(())
}

#[tauri::command]
pub fn cancel_model_download(dl_state: State<DownloadState>) -> Result<(), String> {
    let mut guard = dl_state.0.lock().unwrap();
    if let Some(cancel) = guard.take() {
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Coach LLM inference
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn load_coach_model(
    app_handle: AppHandle,
    engine: State<'_, SharedCoachEngine>,
) -> Result<bool, String> {
    let model_path = {
        let dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        dir.join("models").join("brain").join("model.bin")
    };

    let mut lock = engine.lock().map_err(|e| format!("Lock failed: {e}"))?;
    crate::coach::load_model(&mut lock, &model_path)
}

#[tauri::command]
pub async fn coach_generate(
    engine: State<'_, SharedCoachEngine>,
    context: String,
) -> Result<String, String> {
    let lock = engine.lock().map_err(|e| format!("Lock failed: {e}"))?;
    crate::coach::generate(&lock, &context)
}

#[tauri::command]
pub fn is_coach_loaded(engine: State<'_, SharedCoachEngine>) -> bool {
    engine.lock().map(|lock| lock.is_loaded()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn tts_speak(
    tts: State<'_, SharedTts>,
    state: State<'_, SharedState>,
    text: String,
) -> Result<(), String> {
    // Dim metronome volume during speech (temporary, not persisted)
    let original_volume = {
        let mut s = state.lock().unwrap();
        let orig = s.volume;
        s.volume = (orig * 0.15).max(0.02);
        orig
    };

    let result = {
        let mut tts_engine = tts.lock().map_err(|e| format!("Lock failed: {e}"))?;
        tts_engine.speak(&text)
    };

    // Restore original volume
    {
        let mut s = state.lock().unwrap();
        s.volume = original_volume;
    }

    result
}

#[tauri::command]
pub fn tts_set_voice(tts: State<'_, SharedTts>, voice: String) {
    if let Ok(mut engine) = tts.lock() {
        engine.set_voice(&voice);
    }
}

#[tauri::command]
pub fn tts_list_voices(tts: State<'_, SharedTts>) -> Vec<(String, String)> {
    tts.lock().map(|e| e.list_available_voices()).unwrap_or_default()
}