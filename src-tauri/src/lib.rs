mod commands;
mod engine;
mod state;

use commands::{
    get_state, save_window_position, set_accent_color, set_always_on_top, set_bpm, set_corner,
    set_playing, set_sound_type, set_subdivision, set_time_signature, set_volume, set_widget_mode,
    show_floating, show_main, toggle_playback, EngineState,
};
use engine::MetronomeEngine;
use state::create_shared_state;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let shared_state = create_shared_state();

            // Restore saved settings from store
            {
                let store = app.store("settings.json")?;
                let mut s = shared_state.lock().unwrap();
                if let Some(v) = store.get("bpm").and_then(|v| v.as_u64()) {
                    s.bpm = (v as u16).clamp(20, 300);
                }
                if let Some(v) = store.get("subdivision").and_then(|v| v.as_u64()) {
                    s.subdivision = (v as u8).clamp(1, 6);
                }
                if let Some(v) = store.get("mode").and_then(|v| v.as_str().map(String::from)) {
                    s.mode = v;
                }
                if let Some(v) = store.get("corner").and_then(|v| v.as_str().map(String::from)) {
                    s.corner = v;
                }
                if let Some(v) = store.get("alwaysOnTop").and_then(|v| v.as_bool()) {
                    s.always_on_top = v;
                }
                if let Some(v) = store.get("accentColor").and_then(|v| v.as_str().map(String::from)) {
                    s.accent_color = v;
                }
                if let Some(v) = store.get("volume").and_then(|v| v.as_f64()) {
                    s.volume = (v as f32).clamp(0.0, 1.0);
                }
                if let Some(v) = store.get("soundType").and_then(|v| v.as_str().map(String::from)) {
                    s.sound_type = v;
                }
                if let Some(v) = store.get("timeSignature").and_then(|v| v.as_u64()) {
                    s.time_signature = v as u8;
                }
            }

            app.manage(shared_state);
            app.manage(EngineState(Mutex::new(MetronomeEngine::new())));

            // Set up system tray
            let show_i = MenuItem::with_id(app, "show", "Show Mustik", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Mustik")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        // Hide floating, show main
                        if let Some(float_win) = app.get_webview_window("floating") {
                            let _ = float_win.hide();
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Start with floating visible, main hidden
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.hide();
            }

            // Restore saved floating widget position
            if let Some(float_win) = app.get_webview_window("floating") {
                let store = app.store("settings.json")?;
                if let Some(pos) = store.get("window_position_floating") {
                    if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_i64()), pos.get("y").and_then(|v| v.as_i64())) {
                        let _ = float_win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                    }
                }
            }

            // Register global shortcuts
            setup_global_shortcuts(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_bpm,
            set_subdivision,
            toggle_playback,
            set_playing,
            set_widget_mode,
            set_corner,
            set_always_on_top,
            set_accent_color,
            set_volume,
            show_main,
            show_floating,
            save_window_position,
            set_sound_type,
            set_time_signature,
        ])
        .on_window_event(|window, event| {
            // Stop the engine + kill audio thread when the app is about to close
            if let tauri::WindowEvent::Destroyed = event {
                // Only act when the last window is destroyed
                if window.app_handle().webview_windows().len() <= 1 {
                    if let Some(engine_state) = window.try_state::<EngineState>() {
                        let mut engine = engine_state.0.lock().unwrap();
                        engine.shutdown();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Mustik");
}

fn setup_global_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    fn persist(app_handle: &AppHandle, shared: &state::SharedState) {
        use tauri_plugin_store::StoreExt;
        if let Ok(store) = app_handle.store("settings.json") {
            let s = shared.lock().unwrap();
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

    // Cmd+Shift+Space → Play / Stop
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Space", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        let state: tauri::State<state::SharedState> = app_handle.state();
        let engine_state: tauri::State<EngineState> = app_handle.state();
        let is_playing = state.lock().unwrap().is_playing;

        let mut engine = engine_state.0.lock().unwrap();
        if is_playing {
            engine.stop();
            state.lock().unwrap().is_playing = false;
        } else {
            engine.start(state.inner().clone(), app_handle.clone());
            state.lock().unwrap().is_playing = true;
        }
        let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
    })?;

    // Cmd+Shift+Up → BPM +5
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Up", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        let state: tauri::State<state::SharedState> = app_handle.state();
        {
            let mut s = state.lock().unwrap();
            s.bpm = (s.bpm + 5).min(300);
        }
        let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
        persist(&app_handle, &state);
    })?;

    // Cmd+Shift+Down → BPM -5
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Down", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        let state: tauri::State<state::SharedState> = app_handle.state();
        {
            let mut s = state.lock().unwrap();
            s.bpm = (s.bpm.saturating_sub(5)).max(20);
        }
        let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
        persist(&app_handle, &state);
    })?;

    // Cmd+Shift+Alt+Up → BPM +1
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Alt+Up", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        let state: tauri::State<state::SharedState> = app_handle.state();
        {
            let mut s = state.lock().unwrap();
            s.bpm = (s.bpm + 1).min(300);
        }
        let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
        persist(&app_handle, &state);
    })?;

    // Cmd+Shift+Alt+Down → BPM -1
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Alt+Down", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        let state: tauri::State<state::SharedState> = app_handle.state();
        {
            let mut s = state.lock().unwrap();
            s.bpm = s.bpm.saturating_sub(1).max(20);
        }
        let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
        persist(&app_handle, &state);
    })?;

    // Cmd+Shift+M → Toggle compact/comfortable widget mode
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+M", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        let state: tauri::State<state::SharedState> = app_handle.state();
        {
            let mut s = state.lock().unwrap();
            s.mode = if s.mode == "compact" {
                "comfortable".to_string()
            } else {
                "compact".to_string()
            };
        }
        let _ = app_handle.emit("state-changed", &*state.lock().unwrap());
        persist(&app_handle, &state);
    })?;

    // Cmd+Shift+O → Toggle between main window and floating widget
    let app_handle = app.handle().clone();
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+O", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed { return; }
        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let Some(float_win) = app_handle.get_webview_window("floating") {
                let main_visible = main_win.is_visible().unwrap_or(false);
                if main_visible {
                    let _ = main_win.hide();
                    let _ = float_win.show();
                } else {
                    let _ = float_win.hide();
                    let _ = main_win.show();
                    let _ = main_win.set_focus();
                }
            }
        }
    })?;

    Ok(())
}
