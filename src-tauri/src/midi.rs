use midir::{MidiInput, MidiInputConnection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MidiMsgType {
    #[serde(rename = "cc")]
    ControlChange,
    #[serde(rename = "note")]
    NoteOn,
    #[serde(rename = "pc")]
    ProgramChange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiBinding {
    pub action: String,
    pub channel: Option<u8>,
    #[serde(rename = "msgType")]
    pub msg_type: MidiMsgType,
    pub number: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiDeviceInfo {
    pub id: usize,
    pub name: String,
    #[serde(rename = "isConnected")]
    pub is_connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiActivity {
    pub channel: u8,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub number: u8,
    pub value: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiActionEvent {
    pub action: String,
}

// ---------------------------------------------------------------------------
// MidiListener
// ---------------------------------------------------------------------------

pub struct MidiListener {
    bindings: Arc<Mutex<Vec<MidiBinding>>>,
    connection: Arc<Mutex<Option<MidiInputConnection<()>>>>,
    connected_device: Arc<Mutex<Option<String>>>,
    alive: Arc<AtomicBool>,
    /// Optional callback for forwarding NoteOn as evaluation onsets.
    /// Set when evaluation is active, cleared when stopped.
    onset_callback: Arc<Mutex<Option<Arc<dyn Fn(u8) + Send + Sync>>>>,
}

impl MidiListener {
    pub fn new() -> Self {
        Self {
            bindings: Arc::new(Mutex::new(Vec::new())),
            connection: Arc::new(Mutex::new(None)),
            connected_device: Arc::new(Mutex::new(None)),
            alive: Arc::new(AtomicBool::new(true)),
            onset_callback: Arc::new(Mutex::new(None)),
        }
    }

    pub fn list_devices(&self) -> Vec<MidiDeviceInfo> {
        let midi_in = match MidiInput::new("yames-list") {
            Ok(m) => m,
            Err(_) => return Vec::new(),
        };
        let ports = midi_in.ports();
        let connected_name = self.connected_device.lock().unwrap().clone();

        ports
            .iter()
            .enumerate()
            .filter_map(|(i, port)| {
                midi_in.port_name(port).ok().map(|name| MidiDeviceInfo {
                    id: i,
                    name: name.clone(),
                    is_connected: connected_name.as_deref() == Some(&name),
                })
            })
            .collect()
    }

    pub fn connect(&self, device_name: &str, app_handle: AppHandle) -> Result<(), String> {
        // Disconnect existing connection first
        self.disconnect();

        let midi_in = MidiInput::new("yames-input")
            .map_err(|e| format!("Failed to create MIDI input: {}", e))?;

        let ports = midi_in.ports();
        let port = ports
            .iter()
            .find(|p| {
                midi_in
                    .port_name(p)
                    .map(|n| n == device_name)
                    .unwrap_or(false)
            })
            .ok_or_else(|| format!("MIDI device '{}' not found", device_name))?
            .clone();

        let bindings = self.bindings.clone();
        let app = app_handle.clone();
        let onset_cb = self.onset_callback.clone();

        let conn = midi_in
            .connect(
                &port,
                "yames-midi",
                move |_timestamp, message, _| {
                    if let Some((channel, msg_type, number, value)) = parse_midi(message) {
                        // Emit activity for MIDI learn mode
                        let activity = MidiActivity {
                            channel,
                            msg_type: match msg_type {
                                MidiMsgType::ControlChange => "cc".to_string(),
                                MidiMsgType::NoteOn => "note".to_string(),
                                MidiMsgType::ProgramChange => "pc".to_string(),
                            },
                            number,
                            value,
                        };
                        let _ = app.emit("midi-activity", &activity);

                        // Forward NoteOn as onset for evaluation (if callback set)
                        if msg_type == MidiMsgType::NoteOn && value > 0 {
                            if let Ok(cb) = onset_cb.lock() {
                                if let Some(ref f) = *cb {
                                    f(value);
                                }
                            }
                        }

                        // Check bindings
                        let binds = bindings.lock().unwrap();
                        for binding in binds.iter() {
                            if binding.msg_type == msg_type
                                && binding.number == number
                                && binding
                                    .channel
                                    .map_or(true, |ch| ch == channel)
                            {
                                // For CC, only trigger on value > 63 (button press)
                                // For NoteOn, only trigger on velocity > 0
                                let should_trigger = match msg_type {
                                    MidiMsgType::ControlChange => value > 63,
                                    MidiMsgType::NoteOn => value > 0,
                                    MidiMsgType::ProgramChange => true,
                                };
                                if should_trigger {
                                    let _ = app.emit(
                                        "midi-action",
                                        &MidiActionEvent {
                                            action: binding.action.clone(),
                                        },
                                    );
                                }
                            }
                        }
                    }
                },
                (),
            )
            .map_err(|e| format!("Failed to connect to MIDI device: {}", e))?;

        *self.connection.lock().unwrap() = Some(conn);
        *self.connected_device.lock().unwrap() = Some(device_name.to_string());

        Ok(())
    }

    pub fn disconnect(&self) {
        let mut conn = self.connection.lock().unwrap();
        if let Some(c) = conn.take() {
            c.close();
        }
        *self.connected_device.lock().unwrap() = None;
    }

    pub fn is_connected(&self) -> bool {
        self.connection.lock().unwrap().is_some()
    }

    pub fn connected_device_name(&self) -> Option<String> {
        self.connected_device.lock().unwrap().clone()
    }

    pub fn set_bindings(&self, new_bindings: Vec<MidiBinding>) {
        *self.bindings.lock().unwrap() = new_bindings;
    }

    pub fn get_bindings(&self) -> Vec<MidiBinding> {
        self.bindings.lock().unwrap().clone()
    }

    pub fn add_binding(&self, binding: MidiBinding) {
        let mut bindings = self.bindings.lock().unwrap();
        // Remove existing binding for same action
        bindings.retain(|b| b.action != binding.action);
        // Remove any other binding using the same MIDI signal (prevent conflicts)
        bindings.retain(|b| !(b.msg_type == binding.msg_type && b.number == binding.number && b.channel == binding.channel));
        bindings.push(binding);
    }

    pub fn remove_binding(&self, action: &str) {
        let mut bindings = self.bindings.lock().unwrap();
        bindings.retain(|b| b.action != action);
    }

    /// Set a callback for forwarding MIDI NoteOn as evaluation onsets.
    /// Called with velocity (0–127).
    pub fn set_onset_callback<F>(&self, f: F)
    where
        F: Fn(u8) + Send + Sync + 'static,
    {
        *self.onset_callback.lock().unwrap() = Some(Arc::new(f));
    }

    /// Clear the onset callback (when evaluation stops).
    pub fn clear_onset_callback(&self) {
        *self.onset_callback.lock().unwrap() = None;
    }

    /// Start device polling thread that emits "midi-devices-changed" when ports change
    pub fn start_device_polling(&self, app_handle: AppHandle) {
        let alive = self.alive.clone();
        let connected_device = self.connected_device.clone();
        let connection = self.connection.clone();

        thread::spawn(move || {
            let mut last_device_names: Vec<String> = Vec::new();

            while alive.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(3));

                let midi_in = match MidiInput::new("yames-poll") {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let ports = midi_in.ports();
                let current_names: Vec<String> = ports
                    .iter()
                    .filter_map(|p| midi_in.port_name(p).ok())
                    .collect();

                if current_names != last_device_names {
                    // Check if connected device was disconnected
                    let conn_name = connected_device.lock().unwrap().clone();
                    if let Some(ref name) = conn_name {
                        if !current_names.contains(name) {
                            // Device disconnected — clean up
                            let mut conn = connection.lock().unwrap();
                            if let Some(c) = conn.take() {
                                c.close();
                            }
                            *connected_device.lock().unwrap() = None;
                        }
                    }

                    let devices: Vec<MidiDeviceInfo> = current_names
                        .iter()
                        .enumerate()
                        .map(|(i, name)| MidiDeviceInfo {
                            id: i,
                            name: name.clone(),
                            is_connected: conn_name.as_deref() == Some(name.as_str()),
                        })
                        .collect();

                    let _ = app_handle.emit("midi-devices-changed", &devices);
                    last_device_names = current_names;
                }
            }
        });
    }

    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Relaxed);
        self.disconnect();
    }
}

impl Default for MidiListener {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// MIDI message parsing
// ---------------------------------------------------------------------------

fn parse_midi(bytes: &[u8]) -> Option<(u8, MidiMsgType, u8, u8)> {
    if bytes.is_empty() {
        return None;
    }
    let status = bytes[0];
    let channel = status & 0x0F;
    match status & 0xF0 {
        0x90 if bytes.len() >= 3 => {
            Some((channel, MidiMsgType::NoteOn, bytes[1], bytes[2]))
        }
        0xB0 if bytes.len() >= 3 => {
            Some((channel, MidiMsgType::ControlChange, bytes[1], bytes[2]))
        }
        0xC0 if bytes.len() >= 2 => {
            Some((channel, MidiMsgType::ProgramChange, bytes[1], 127))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Shared state type for Tauri management
// ---------------------------------------------------------------------------

pub type SharedMidi = Arc<Mutex<MidiListener>>;

pub fn create_shared_midi() -> SharedMidi {
    Arc::new(Mutex::new(MidiListener::new()))
}
