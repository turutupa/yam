use crate::engine::MetronomeEngine;
use crate::midi::{MidiBinding, MidiDeviceInfo, MidiMsgType, SharedMidi};
use crate::state::{AppState, SharedState};
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
            "linear" | "zigzag" => mode,
            _ => "linear".to_string(),
        };
        s.speed_ramp.cyclic = cyclic;
        s.speed_ramp.warmup_beats = warmup_beats.clamp(0, 8);
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