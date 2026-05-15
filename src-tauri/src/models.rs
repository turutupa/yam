use std::path::PathBuf;
use serde::Serialize;
use tauri::{AppHandle, Manager};

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

    let voice_ready = voice_dir.join("default.onnx").exists();
    let voice_size_bytes = if voice_ready { dir_size(&voice_dir) } else { 0 };

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
