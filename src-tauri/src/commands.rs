use crate::engine::MetronomeEngine;
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
        store.set("accentColor", serde_json::json!(s.accent_color));
        store.set("volume", serde_json::json!(s.volume));
        store.set("soundType", serde_json::json!(s.sound_type));
        store.set("timeSignature", serde_json::json!(s.time_signature));
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
pub fn set_corner(corner: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.corner = corner;
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
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.set_always_on_top(enabled);
    }
    let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn show_main(app_handle: AppHandle) {
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.hide();
    }
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.show();
        let _ = main_win.set_focus();
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
}

#[tauri::command]
pub fn set_accent_color(color: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.accent_color = color;
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
