use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Status of model components on disk.
#[derive(Debug, Clone, Serialize)]
pub struct ModelStatus {
    /// Whether the brain model is downloaded
    #[serde(rename = "brainReady")]
    pub brain_ready: bool,
    /// Which tier is downloaded (null if none)
    #[serde(rename = "brainTier")]
    pub brain_tier: Option<String>,
    /// Size on disk in bytes
    #[serde(rename = "brainSizeBytes")]
    pub brain_size_bytes: u64,
    /// Whether voice models are downloaded
    #[serde(rename = "voiceReady")]
    pub voice_ready: bool,
    /// Size on disk in bytes
    #[serde(rename = "voiceSizeBytes")]
    pub voice_size_bytes: u64,
}

/// Get the models directory inside the app data dir.
fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("models"))
}

/// Check which models are available on disk.
pub fn check_model_status(app: &AppHandle) -> Result<ModelStatus, String> {
    let dir = models_dir(app)?;
    let brain_dir = dir.join("brain");
    let voice_dir = dir.join("voice");

    let brain_ready = brain_dir.join("model.bin").exists();
    let brain_tier = if brain_ready {
        std::fs::read_to_string(brain_dir.join("tier")).ok()
    } else {
        None
    };
    let brain_size_bytes = if brain_ready { dir_size(&brain_dir) } else { 0 };

    let voice_ready = voice_dir.join("en_US-lessac-medium.onnx").exists();
    let voice_size_bytes = if voice_dir.exists() { dir_size(&voice_dir) } else { 0 };

    Ok(ModelStatus {
        brain_ready,
        brain_tier,
        brain_size_bytes,
        voice_ready,
        voice_size_bytes,
    })
}

/// Write model data from the frontend to disk.
pub fn write_model_file(
    app: &AppHandle,
    component: &str,
    filename: &str,
    data: &[u8],
) -> Result<String, String> {
    let dir = models_dir(app)?;
    let component_dir = dir.join(component);
    std::fs::create_dir_all(&component_dir)
        .map_err(|e| format!("Failed to create directory: {e}"))?;
    let path = component_dir.join(filename);
    std::fs::write(&path, data).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete all downloaded models.
pub fn delete_models(app: &AppHandle) -> Result<(), String> {
    let dir = models_dir(app)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete models: {e}"))?;
    }
    Ok(())
}

/// Get the models directory path (for frontend to know where files go).
pub fn get_models_path(app: &AppHandle) -> Result<String, String> {
    let dir = models_dir(app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Recursively compute directory size in bytes.
fn dir_size(path: &PathBuf) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

// ---------------------------------------------------------------------------
// Backend model download (survives frontend hot-reloads)
// ---------------------------------------------------------------------------

/// Shared cancel flag for the active download.
pub type DownloadCancelFlag = Arc<AtomicBool>;

/// Progress event emitted to the frontend during download.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub component: String,
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    pub fraction: f64,
    pub done: bool,
}

/// Download a model file from `url` to the models directory.
/// Runs on a background thread. Emits "model-download-progress" events.
/// After the brain model, automatically downloads Piper binary + voice models.
/// Returns immediately. The cancel flag can be set to abort.
pub fn start_download(
    app: AppHandle,
    url: String,
    component: String,
    filename: String,
    tier: String,
    cancel: DownloadCancelFlag,
) {
    std::thread::spawn(move || {
        let models_dir = match app.path().app_data_dir() {
            Ok(d) => d.join("models"),
            Err(e) => {
                let _ = app.emit("model-download-complete", serde_json::json!({ "success": false, "error": format!("{e}") }));
                return;
            }
        };

        // Step 1: Download the brain model (skip if already present)
        let brain_path = models_dir.join(&component).join(&filename);
        if !brain_path.exists() {
            let result = do_download(&app, &url, &component, &filename, &tier, &cancel, "brain");
            if let Err(e) = result {
                let event = if e == "cancelled" {
                    serde_json::json!({ "success": false, "cancelled": true })
                } else {
                    serde_json::json!({ "success": false, "error": e })
                };
                let _ = app.emit("model-download-complete", event);
                return;
            }
        } else {
            // Brain exists, just ensure tier marker is correct
            let tier_path = models_dir.join(&component).join("tier");
            let _ = std::fs::write(&tier_path, &tier);
        }

        // Step 2: Download Piper binary + voices (if not already present)

        // Download Piper binary
        let piper_dir = models_dir.join("piper");
        if !piper_dir.join("piper").exists() {
            let _ = app.emit("model-download-progress", DownloadProgress {
                component: "Piper TTS engine".to_string(),
                downloaded_bytes: 0, total_bytes: 0, fraction: 0.0, done: false,
            });
            let piper_url = crate::tts::piper_binary_url();
            let tar_path = models_dir.join("piper.tar.gz");
            if let Err(e) = curl_download(&app, piper_url, &tar_path, &cancel, "Piper TTS engine") {
                if e == "cancelled" {
                    let _ = app.emit("model-download-complete", serde_json::json!({ "success": false, "cancelled": true }));
                    return;
                }
                // Non-fatal — voices won't work but brain still works
                eprintln!("[yames] Failed to download Piper binary: {e}");
                let _ = app.emit("model-download-progress", DownloadProgress {
                    component: format!("Piper TTS engine (failed: {e})"),
                    downloaded_bytes: 0, total_bytes: 0, fraction: 0.0, done: true,
                });
            } else {
                // Extract tar.gz
                let _ = std::fs::create_dir_all(&models_dir);
                let extract = std::process::Command::new("tar")
                    .arg("xzf")
                    .arg(&tar_path)
                    .arg("-C")
                    .arg(&models_dir)
                    .output();
                let _ = std::fs::remove_file(&tar_path);
                if let Err(e) = extract {
                    eprintln!("Failed to extract Piper: {e}");
                }
            }
        }

        // Download voice models
        let voice_dir = models_dir.join("voice");
        let _ = std::fs::create_dir_all(&voice_dir);
        for (voice_id, onnx_url, json_url) in crate::tts::voice_model_urls() {
            let onnx_name = format!("en_US-{voice_id}-medium.onnx");
            let json_name = format!("en_US-{voice_id}-medium.onnx.json");
            if voice_dir.join(&onnx_name).exists() {
                continue; // Already downloaded
            }
            if cancel.load(Ordering::Relaxed) {
                let _ = app.emit("model-download-complete", serde_json::json!({ "success": false, "cancelled": true }));
                return;
            }
            let label = format!("Voice: {voice_id}");
            let _ = app.emit("model-download-progress", DownloadProgress {
                component: label.clone(), downloaded_bytes: 0, total_bytes: 0, fraction: 0.0, done: false,
            });
            // Download .onnx
            if let Err(e) = curl_download(&app, onnx_url, &voice_dir.join(&onnx_name), &cancel, &label) {
                if e == "cancelled" {
                    let _ = app.emit("model-download-complete", serde_json::json!({ "success": false, "cancelled": true }));
                    return;
                }
                eprintln!("[yames] Failed to download voice {voice_id}: {e}");
                let _ = app.emit("model-download-progress", DownloadProgress {
                    component: format!("Voice: {voice_id} (failed: {e})"),
                    downloaded_bytes: 0, total_bytes: 0, fraction: 0.0, done: true,
                });
                continue;
            }
            // Download .onnx.json (small, no progress needed)
            let _ = curl_download(&app, json_url, &voice_dir.join(&json_name), &cancel, &label);
        }

        let _ = app.emit("model-download-complete", serde_json::json!({ "success": true, "tier": tier }));
    });
}

/// Download a file with curl. Returns Ok(()) on success.
fn curl_download(
    app: &AppHandle,
    url: &str,
    dest: &std::path::Path,
    cancel: &AtomicBool,
    label: &str,
) -> Result<(), String> {
    use std::process::{Command, Stdio};

    let part_path = dest.with_extension("part");
    let resume = part_path.exists();

    let mut cmd = Command::new("curl");
    cmd.arg("-L")
        .arg("--retry").arg("3")
        .arg("--retry-delay").arg("2")
        .arg("--connect-timeout").arg("15")
        .arg("--max-time").arg("600")
        .arg("--progress-bar")
        .arg("-o").arg(&part_path)
        .arg(url)
        .stderr(Stdio::piped())
        .stdout(Stdio::null());

    // Only use resume if a partial file already exists
    if resume {
        cmd.arg("-C").arg("-");
    }

    eprintln!("[yames] curl_download: url={url} dest={}", dest.display());
    // Log proxy env for debugging
    for var in &["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
        if let Ok(val) = std::env::var(var) {
            eprintln!("[yames]   {var}={val}");
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start curl: {e}"))?;
    let stderr = child.stderr.take().unwrap();

    // curl --progress-bar uses \r (carriage return) not \n, so read byte-by-byte
    let mut last_emit = std::time::Instant::now();
    let mut line_buf = String::new();
    let mut reader = std::io::BufReader::new(stderr);
    loop {
        use std::io::Read;
        let mut byte = [0u8; 1];
        match reader.read(&mut byte) {
            Ok(0) => break, // EOF
            Ok(_) => {
                if byte[0] == b'\r' || byte[0] == b'\n' {
                    if !line_buf.is_empty() {
                        if cancel.load(Ordering::Relaxed) {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err("cancelled".to_string());
                        }
                        if let Some(pct) = parse_curl_progress(&line_buf) {
                            if last_emit.elapsed().as_millis() > 200 {
                                let _ = app.emit("model-download-progress", DownloadProgress {
                                    component: label.to_string(),
                                    downloaded_bytes: 0,
                                    total_bytes: 0,
                                    fraction: pct / 100.0,
                                    done: false,
                                });
                                last_emit = std::time::Instant::now();
                            }
                        }
                        line_buf.clear();
                    }
                } else {
                    line_buf.push(byte[0] as char);
                }
            }
            Err(_) => break,
        }
    }

    let status = child.wait().map_err(|e| format!("curl failed: {e}"))?;
    if !status.success() {
        // Clean up partial file on failure
        let _ = std::fs::remove_file(&part_path);
        return Err(format!("curl exited with status {status}"));
    }

    if !part_path.exists() {
        return Err("curl completed but no file was written".to_string());
    }

    std::fs::rename(&part_path, dest).map_err(|e| format!("Failed to rename file: {e}"))?;
    Ok(())
}

fn do_download(
    app: &AppHandle,
    url: &str,
    component: &str,
    filename: &str,
    tier: &str,
    cancel: &AtomicBool,
    label: &str,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("models")
        .join(component);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {e}"))?;

    let path = dir.join(filename);
    curl_download(app, url, &path, cancel, label)?;

    // Write the tier marker file
    let tier_path = dir.join("tier");
    std::fs::write(&tier_path, tier).map_err(|e| format!("Failed to write tier: {e}"))?;

    // Final progress event
    let _ = app.emit("model-download-progress", DownloadProgress {
        component: label.to_string(),
        downloaded_bytes: 0,
        total_bytes: 0,
        fraction: 1.0,
        done: true,
    });

    Ok(())
}

/// Parse percentage from curl progress bar output.
/// curl --progress-bar outputs lines like "###                         5.2%"
fn parse_curl_progress(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    // Look for a percentage at the end of the line
    if let Some(pos) = trimmed.rfind('%') {
        // Walk backwards to find the start of the number
        let before = &trimmed[..pos];
        let num_start = before.rfind(|c: char| !c.is_ascii_digit() && c != '.').map(|i| i + 1).unwrap_or(0);
        before[num_start..].parse::<f64>().ok()
    } else {
        None
    }
}
