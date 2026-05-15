mod audio_input;
mod clock;
mod coach;
mod commands;
mod engine;
mod midi;
mod models;
mod onset;
mod session;
mod state;
mod timing;
mod tts;

use audio_input::create_shared_audio_input;
use coach::create_shared_engine;
use tts::create_shared_tts;
use commands::{
    get_state, get_active_tab, get_calibration_offset, open_url, save_window_position, set_active_tab, set_always_on_top, set_bpm, set_calibration_offset,
    set_playing, set_sound_type, set_subdivision, set_theme, set_time_signature, set_volume, set_widget_mode,
    set_widget_always_on_top, show_floating, show_main, toggle_playback, configure_speed_ramp, start_speed_ramp,
    start_speed_ramp_from, stop_speed_ramp, set_adaptive_decision,
    list_midi_devices, connect_midi_device, disconnect_midi_device, set_midi_binding, clear_midi_binding, get_midi_bindings,
    list_presets, save_preset, delete_preset, reorder_presets,
    list_audio_input_devices, start_evaluation, stop_evaluation, get_evaluation_state,
    get_session_report, clear_session,
    save_session, get_session_history, delete_session, clear_all_sessions,
    start_recording, stop_recording, start_playback, stop_playback, discard_recording, get_waveform,
    set_input_gain,
    list_audio_output_devices, set_audio_output_device,
    get_model_status, write_model_chunk, get_models_path, delete_models,
    start_model_download, cancel_model_download,
    load_coach_model, coach_generate, is_coach_loaded,
    tts_speak, tts_set_voice, tts_list_voices,
    EngineState, DownloadState,
};
use onset::create_shared_onset_detector;
use engine::MetronomeEngine;
use midi::create_shared_midi;
use session::create_shared_session_accumulator;
use state::{create_shared_state, SharedState};
use timing::{create_beat_log, TimingAnalyzer};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
                if let Some(v) = store.get("widgetAlwaysOnTop").and_then(|v| v.as_bool()) {
                    s.widget_always_on_top = v;
                }
                if let Some(v) = store.get("accentColor").and_then(|v| v.as_str().map(String::from)) {
                    s.accent_color = v;
                }
                if let Some(v) = store.get("theme").and_then(|v| v.as_str().map(String::from)) {
                    s.theme = v;
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
                if let Some(v) = store.get("speedRamp") {
                    if let Some(sb) = v.get("startBpm").and_then(|x| x.as_u64()) {
                        s.speed_ramp.start_bpm = (sb as u16).clamp(20, 300);
                    }
                    if let Some(tb) = v.get("targetBpm").and_then(|x| x.as_u64()) {
                        s.speed_ramp.target_bpm = (tb as u16).clamp(20, 300);
                    }
                    if let Some(inc) = v.get("increment").and_then(|x| x.as_u64()) {
                        s.speed_ramp.increment = (inc as u16).clamp(1, 50);
                    }
                    if let Some(dec) = v.get("decrement").and_then(|x| x.as_u64()) {
                        s.speed_ramp.decrement = (dec as u16).clamp(1, 50);
                    }
                    if let Some(bps) = v.get("barsPerStep").and_then(|x| x.as_u64()) {
                        s.speed_ramp.bars_per_step = (bps as u8).clamp(1, 32);
                    }
                    if let Some(bpb) = v.get("beatsPerBar").and_then(|x| x.as_u64()) {
                        s.speed_ramp.beats_per_bar = (bpb as u8).clamp(1, 12);
                    }
                    if let Some(m) = v.get("mode").and_then(|x| x.as_str()) {
                        s.speed_ramp.mode = m.to_string();
                    }
                    if let Some(c) = v.get("cyclic").and_then(|x| x.as_bool()) {
                        s.speed_ramp.cyclic = c;
                    }
                    s.speed_ramp.current_bpm = s.speed_ramp.start_bpm;
                }
            }

            app.manage(shared_state);
            let beat_log = create_beat_log();
            let mut engine = MetronomeEngine::new(beat_log.clone());

            // Restore saved audio output device
            {
                let store = app.store("settings.json")?;
                if let Some(device_name) = store.get("audioOutputDevice").and_then(|v| v.as_str().map(String::from)) {
                    engine.set_device_name(Some(device_name));
                }
            }

            app.manage(EngineState(Mutex::new(engine)));

            // Start audio output device polling
            engine::start_audio_device_polling(app.handle().clone());
            app.manage(create_shared_audio_input());
            app.manage(create_shared_onset_detector());
            app.manage(Arc::new(Mutex::new(TimingAnalyzer::new(beat_log))));
            app.manage(create_shared_session_accumulator());
            app.manage(create_shared_engine());
            let shared_tts = create_shared_tts();
            {
                let models_dir = app.path().app_data_dir().unwrap().join("models");
                shared_tts.lock().unwrap().set_models_dir(models_dir);
            }
            app.manage(shared_tts);
            app.manage(DownloadState(std::sync::Mutex::new(None)));

            // Set up MIDI listener
            let shared_midi = create_shared_midi();
            {
                let listener = shared_midi.lock().unwrap();
                // Restore saved MIDI bindings
                let store = app.store("settings.json")?;
                if let Some(bindings_val) = store.get("midiBindings") {
                    if let Ok(bindings) = serde_json::from_value::<Vec<midi::MidiBinding>>(bindings_val.clone()) {
                        listener.set_bindings(bindings);
                    }
                }
                // Start device polling
                listener.start_device_polling(app.handle().clone());
                // Auto-reconnect to last device
                if let Some(device_name) = store.get("midiDevice").and_then(|v| v.as_str().map(String::from)) {
                    let _ = listener.connect(&device_name, app.handle().clone());
                }
            }
            app.manage(shared_midi);

            // Set up system tray
            let show_i = MenuItem::with_id(app, "show", "Show Yames", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Yames")
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

            // Start with the last-used window visible
            let last_window = {
                let store = app.store("settings.json")?;
                store.get("lastWindow")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "floating".to_string())
            };

            if let Some(main_win) = app.get_webview_window("main") {
                if last_window == "main" {
                    let _ = main_win.show();
                    let _ = main_win.set_focus();
                } else {
                    let _ = main_win.hide();
                }
                // Apply saved always-on-top setting for main window
                let aot = { app.state::<SharedState>().lock().unwrap().always_on_top };
                let _ = main_win.set_always_on_top(aot);

                // Restore saved main window size
                let store = app.store("settings.json")?;
                if let Some(size) = store.get("window_size_main") {
                    if let (Some(w), Some(h)) = (size.get("width").and_then(|v| v.as_u64()), size.get("height").and_then(|v| v.as_u64())) {
                        let _ = main_win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                    }
                }
                // Restore saved main window position (with bounds check)
                if let Some(pos) = store.get("window_position_main") {
                    if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_i64()), pos.get("y").and_then(|v| v.as_i64())) {
                        if is_position_visible(x as i32, y as i32, &main_win) {
                            let _ = main_win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                        } else {
                            let _ = main_win.center();
                        }
                    }
                }

            }

            // Restore saved floating widget position (and visibility)
            if let Some(float_win) = app.get_webview_window("floating") {
                if last_window != "main" {
                    let _ = float_win.show();
                } else {
                    let _ = float_win.hide();
                }
                // Apply saved widget always-on-top
                let widget_aot = { app.state::<SharedState>().lock().unwrap().widget_always_on_top };
                let _ = float_win.set_always_on_top(widget_aot);
                let store = app.store("settings.json")?;
                if let Some(pos) = store.get("window_position_floating") {
                    if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_i64()), pos.get("y").and_then(|v| v.as_i64())) {
                        if is_position_visible(x as i32, y as i32, &float_win) {
                            let _ = float_win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                        } else {
                            let _ = float_win.center();
                        }
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_bpm,
            set_subdivision,
            toggle_playback,
            set_playing,
            set_widget_mode,
            set_always_on_top,
            set_widget_always_on_top,
            set_theme,
            set_volume,
            show_main,
            show_floating,
            save_window_position,
            set_sound_type,
            set_time_signature,
            configure_speed_ramp,
            start_speed_ramp,
            start_speed_ramp_from,
            stop_speed_ramp,
            set_adaptive_decision,
            set_active_tab,
            get_active_tab,
            set_calibration_offset,
            get_calibration_offset,
            open_url,
            list_midi_devices,
            connect_midi_device,
            disconnect_midi_device,
            set_midi_binding,
            clear_midi_binding,
            get_midi_bindings,
            list_presets,
            save_preset,
            delete_preset,
            reorder_presets,
            list_audio_input_devices,
            start_evaluation,
            stop_evaluation,
            get_evaluation_state,
            get_session_report,
            clear_session,
            save_session,
            get_session_history,
            delete_session,
            clear_all_sessions,
            start_recording,
            stop_recording,
            start_playback,
            stop_playback,
            discard_recording,
            get_waveform,
            set_input_gain,
            list_audio_output_devices,
            set_audio_output_device,
            get_model_status,
            write_model_chunk,
            get_models_path,
            delete_models,
            start_model_download,
            cancel_model_download,
            load_coach_model,
            coach_generate,
            is_coach_loaded,
            tts_speak,
            tts_set_voice,
            tts_list_voices,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Quit the entire app when user closes any window
                    if let Some(engine_state) = window.try_state::<EngineState>() {
                        let mut engine = engine_state.0.lock().unwrap();
                        engine.shutdown();
                    }
                    window.app_handle().exit(0);
                }
                tauri::WindowEvent::Resized(size) => {
                    // Save main window size on resize
                    if window.label() == "main" && size.width > 0 && size.height > 0 {
                        use tauri_plugin_store::StoreExt;
                        if let Ok(store) = window.app_handle().store("settings.json") {
                            store.set("window_size_main", serde_json::json!({ "width": size.width, "height": size.height }));
                        }
                    }
                }
                tauri::WindowEvent::Moved(pos) => {
                    // Save main window position on move
                    if window.label() == "main" {
                        use tauri_plugin_store::StoreExt;
                        if let Ok(store) = window.app_handle().store("settings.json") {
                            store.set("window_position_main", serde_json::json!({ "x": pos.x, "y": pos.y }));
                        }
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    // Stop the engine + kill audio thread when the app is about to close
                    if window.app_handle().webview_windows().len() <= 1 {
                        if let Some(engine_state) = window.try_state::<EngineState>() {
                            let mut engine = engine_state.0.lock().unwrap();
                            engine.shutdown();
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Yames");
}

/// Check if a window position is at least partially visible on any available monitor.
/// Returns false if the position would place the window entirely off-screen.
fn is_position_visible(x: i32, y: i32, window: &tauri::WebviewWindow) -> bool {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let pos = monitor.position();
        let size = monitor.size();
        let margin = 100; // At least 100px must be visible
        let screen_left = pos.x;
        let screen_top = pos.y;
        let screen_right = pos.x + size.width as i32;
        let screen_bottom = pos.y + size.height as i32;
        x > screen_left - (size.width as i32 - margin)
            && x < screen_right - margin
            && y > screen_top - (size.height as i32 - margin)
            && y < screen_bottom - margin
    } else if let Ok(monitors) = window.available_monitors() {
        // Check against all monitors
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();
            let screen_right = pos.x + size.width as i32;
            let screen_bottom = pos.y + size.height as i32;
            if x >= pos.x - 200 && x < screen_right && y >= pos.y - 200 && y < screen_bottom {
                return true;
            }
        }
        false
    } else {
        // Can't determine monitors, allow the position
        true
    }
}
