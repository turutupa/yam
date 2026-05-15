import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import type { AppState, BeatEvent, SpeedRamp, Subdivision } from "./types";

// Shared store instance (lazy singleton)
let _store: Awaited<ReturnType<typeof load>> | null = null;
async function getStore() {
  if (!_store) _store = await load("settings.json", { autoSave: true, defaults: {} });
  return _store;
}

export async function storeSave(key: string, value: unknown): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
}

export async function storeLoad<T>(key: string): Promise<T | undefined> {
  const store = await getStore();
  return store.get<T>(key);
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export async function getState(): Promise<AppState> {
  return invoke<AppState>("get_state");
}

export async function setBpm(bpm: number): Promise<void> {
  return invoke("set_bpm", { bpm });
}

export async function setSubdivision(subdivision: Subdivision): Promise<void> {
  return invoke("set_subdivision", { subdivision });
}

export async function togglePlayback(): Promise<void> {
  return invoke("toggle_playback");
}

export async function setPlaying(playing: boolean): Promise<void> {
  return invoke("set_playing", { playing });
}

export async function setWidgetMode(mode: "compact" | "comfortable"): Promise<void> {
  return invoke("set_widget_mode", { mode });
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  return invoke("set_always_on_top", { enabled });
}

export async function setWidgetAlwaysOnTop(enabled: boolean): Promise<void> {
  return invoke("set_widget_always_on_top", { enabled });
}

export async function setTheme(theme: string): Promise<void> {
  return invoke("set_theme", { theme });
}

export async function setVolume(volume: number): Promise<void> {
  return invoke("set_volume", { volume });
}

export async function setSoundType(soundType: string): Promise<void> {
  return invoke("set_sound_type", { soundType });
}

export async function setTimeSignature(timeSignature: number): Promise<void> {
  return invoke("set_time_signature", { timeSignature });
}

export async function showMain(): Promise<void> {
  return invoke("show_main");
}

export async function showFloating(): Promise<void> {
  return invoke("show_floating");
}

export function onBeat(callback: (event: BeatEvent) => void) {
  return listen<BeatEvent>("beat", (e) => callback(e.payload));
}

export function onStateChange(callback: (state: AppState) => void) {
  return listen<AppState>("state-changed", (e) => callback(e.payload));
}

export async function configureSpeedRamp(config: {
  startBpm: number;
  targetBpm: number;
  increment: number;
  decrement: number;
  barsPerStep: number;
  beatsPerBar: number;
  mode: string;
  cyclic: boolean;
  warmupBeats?: number;
  aggressiveness?: string;
}): Promise<void> {
  return invoke("configure_speed_ramp", {
    startBpm: config.startBpm,
    targetBpm: config.targetBpm,
    increment: config.increment,
    decrement: config.decrement,
    barsPerStep: config.barsPerStep,
    beatsPerBar: config.beatsPerBar,
    mode: config.mode,
    cyclic: config.cyclic,
    warmupBeats: config.warmupBeats ?? 4,
    aggressiveness: config.aggressiveness ?? null,
  });
}

export async function startSpeedRamp(): Promise<void> {
  return invoke("start_speed_ramp");
}

export async function startSpeedRampFrom(step: number, bpm: number, bar: number = 0): Promise<void> {
  return invoke("start_speed_ramp_from", { step, bpm, bar });
}

export async function stopSpeedRamp(): Promise<void> {
  return invoke("stop_speed_ramp");
}

export async function setAdaptiveDecision(decision: "up" | "hold" | "down"): Promise<void> {
  return invoke("set_adaptive_decision", { decision });
}

export type AdaptiveEvalRequest = {
  currentBpm: number;
  startBpm: number;
  targetBpm: number;
  accuracyPct: number;
  aggressiveness: string;
  currentStep: number;
};

export function onAdaptiveEval(callback: (req: AdaptiveEvalRequest) => void) {
  return listen<AdaptiveEvalRequest>("adaptive-eval", (e) => callback(e.payload));
}

export function onRampStep(callback: (ramp: SpeedRamp) => void) {
  return listen<SpeedRamp>("ramp-step", (e) => callback(e.payload));
}

export function onFullscreenChanged(callback: (isFullscreen: boolean) => void) {
  return listen<boolean>("fullscreen-changed", (e) => callback(e.payload));
}

export async function setActiveTab(tab: string): Promise<void> {
  return invoke("set_active_tab", { tab });
}

export async function getActiveTab(): Promise<string> {
  return invoke<string>("get_active_tab");
}

export async function setCalibrationOffset(offset: number): Promise<void> {
  return invoke("set_calibration_offset", { offset });
}

export async function getCalibrationOffset(): Promise<number | null> {
  return invoke<number | null>("get_calibration_offset");
}

// Update checker — uses Tauri updater plugin for in-app updates
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
  const releaseUrl = "https://github.com/turutupa/yames/releases/latest";
  try {
    const update = await check();
    if (update) {
      return {
        hasUpdate: true,
        currentVersion,
        latestVersion: update.version,
        releaseUrl,
      };
    }
    return { hasUpdate: false, currentVersion, latestVersion: currentVersion, releaseUrl };
  } catch {
    return { hasUpdate: false, currentVersion, latestVersion: currentVersion, releaseUrl };
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  const update = await check();
  if (update) {
    await update.downloadAndInstall();
    await relaunch();
  }
}

// ---------------------------------------------------------------------------
// MIDI
// ---------------------------------------------------------------------------
import type { MidiDeviceInfo, MidiBinding, MidiActivity, MidiMsgType } from "./types";

export async function listMidiDevices(): Promise<MidiDeviceInfo[]> {
  return invoke<MidiDeviceInfo[]>("list_midi_devices");
}

export async function connectMidiDevice(deviceName: string): Promise<void> {
  return invoke("connect_midi_device", { deviceName });
}

export async function disconnectMidiDevice(): Promise<void> {
  return invoke("disconnect_midi_device");
}

export async function setMidiBinding(
  action: string,
  channel: number | null,
  msgType: MidiMsgType,
  number: number,
): Promise<void> {
  return invoke("set_midi_binding", { action, channel, msgType, number });
}

export async function clearMidiBinding(action: string): Promise<void> {
  return invoke("clear_midi_binding", { action });
}

export async function getMidiBindings(): Promise<MidiBinding[]> {
  return invoke<MidiBinding[]>("get_midi_bindings");
}

export function onMidiAction(callback: (action: string) => void) {
  return listen<{ action: string }>("midi-action", (e) => callback(e.payload.action));
}

export function onMidiActivity(callback: (activity: MidiActivity) => void) {
  return listen<MidiActivity>("midi-activity", (e) => callback(e.payload));
}

export function onMidiDevicesChanged(callback: (devices: MidiDeviceInfo[]) => void) {
  return listen<MidiDeviceInfo[]>("midi-devices-changed", (e) => callback(e.payload));
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
import type { Preset } from "./types";

export async function listPresets(): Promise<Preset[]> {
  return invoke<Preset[]>("list_presets");
}

export async function savePreset(preset: Preset): Promise<void> {
  return invoke("save_preset", { preset });
}

export async function deletePreset(id: string): Promise<void> {
  return invoke("delete_preset", { id });
}

export async function reorderPresets(ids: string[]): Promise<void> {
  return invoke("reorder_presets", { ids });
}

// ---------------------------------------------------------------------------
// Audio Output Device
// ---------------------------------------------------------------------------
import type { AudioOutputDevice } from "./types";

export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  return invoke<AudioOutputDevice[]>("list_audio_output_devices");
}

export async function setAudioOutputDevice(deviceName: string | null): Promise<void> {
  return invoke("set_audio_output_device", { deviceName });
}

export function onAudioDevicesChanged(callback: (devices: AudioOutputDevice[]) => void) {
  return listen<AudioOutputDevice[]>("audio-devices-changed", (e) => callback(e.payload));
}

// ---------------------------------------------------------------------------
// Audio Input / Evaluation
// ---------------------------------------------------------------------------
import type { AudioInputDevice, AudioSpectrum, BeatFeedback, SessionReport } from "./types";

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  return invoke<AudioInputDevice[]>("list_audio_input_devices");
}

export function onAudioInputDevicesChanged(callback: (devices: AudioInputDevice[]) => void) {
  return listen<AudioInputDevice[]>("audio-input-devices-changed", (e) => callback(e.payload));
}

export async function startEvaluation(deviceName?: string): Promise<void> {
  return invoke("start_evaluation", { deviceName: deviceName ?? null });
}

export async function stopEvaluation(): Promise<void> {
  return invoke("stop_evaluation");
}

export async function getEvaluationState(): Promise<boolean> {
  return invoke<boolean>("get_evaluation_state");
}

export function onAudioSpectrum(callback: (spectrum: AudioSpectrum) => void) {
  return listen<AudioSpectrum>("audio-spectrum", (e) => callback(e.payload));
}

export function onBeatFeedback(callback: (feedback: BeatFeedback) => void) {
  return listen<BeatFeedback>("beat-feedback", (e) => callback(e.payload));
}

export async function getSessionReport(): Promise<SessionReport | null> {
  return invoke<SessionReport | null>("get_session_report");
}

export async function clearSession(): Promise<void> {
  return invoke("clear_session");
}

// ---------------------------------------------------------------------------
// Session History
// ---------------------------------------------------------------------------
import type { SavedSession } from "./types";

export async function saveSession(session: SavedSession): Promise<void> {
  return invoke("save_session", { session });
}

export async function getSessionHistory(): Promise<SavedSession[]> {
  return invoke<SavedSession[]>("get_session_history");
}

export async function deleteSession(id: string): Promise<void> {
  return invoke("delete_session", { id });
}

export async function clearAllSessions(): Promise<void> {
  return invoke("clear_all_sessions");
}

// ---------------------------------------------------------------------------
// Audio Input Recording / Playback
// ---------------------------------------------------------------------------

export async function startRecording(): Promise<void> {
  return invoke("start_recording");
}

export async function stopRecording(): Promise<number> {
  return invoke<number>("stop_recording");
}

export async function startPlayback(): Promise<void> {
  return invoke("start_playback");
}

export async function stopPlayback(): Promise<void> {
  return invoke("stop_playback");
}

export async function discardRecording(): Promise<void> {
  return invoke("discard_recording");
}

export async function getWaveform(): Promise<number[]> {
  return invoke<number[]>("get_waveform");
}

export async function setInputGain(gainDb: number): Promise<void> {
  return invoke("set_input_gain", { gainDb });
}

// ---------------------------------------------------------------------------
// Model Management
// ---------------------------------------------------------------------------

export type ModelStatus = {
  brainReady: boolean;
  brainTier: string | null;
  brainSizeBytes: number;
  voiceReady: boolean;
  voiceSizeBytes: number;
};

export type DownloadProgress = {
  component: string;
  downloadedBytes: number;
  totalBytes: number;
  fraction: number;
  done: boolean;
};

export async function getModelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("get_model_status");
}

export async function writeModelChunk(
  component: string,
  filename: string,
  data: number[],
): Promise<string> {
  return invoke<string>("write_model_chunk", { component, filename, data });
}

export async function getModelsPath(): Promise<string> {
  return invoke<string>("get_models_path");
}

/**
 * Download a model file from a URL, streaming chunks to the Rust filesystem.
 * Emits DownloadProgress-like callbacks so the UI can show progress.
 */
export async function downloadModelFile(
  url: string,
  component: string,
  filename: string,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw new Error("Download cancelled");
    throw new Error("Could not reach server — check your internet connection");
  }
  if (!response.ok) throw new Error(`Server returned ${response.status} ${response.statusText}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  let downloaded = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new Error("Download cancelled");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    onProgress?.(downloaded, contentLength);
  }

  // Combine all chunks and write to disk via Rust
  const full = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    full.set(chunk, offset);
    offset += chunk.length;
  }

  await writeModelChunk(component, filename, Array.from(full));
}

export async function deleteModels(): Promise<void> {
  return invoke("delete_models");
}

// ---------------------------------------------------------------------------
// Coach LLM Inference
// ---------------------------------------------------------------------------

export async function loadCoachModel(): Promise<boolean> {
  return invoke<boolean>("load_coach_model");
}

export async function coachGenerate(context: string): Promise<string> {
  return invoke<string>("coach_generate", { context });
}

export async function isCoachLoaded(): Promise<boolean> {
  return invoke<boolean>("is_coach_loaded");
}

// ---------------------------------------------------------------------------
// TTS (Text-to-Speech)
// ---------------------------------------------------------------------------

export async function ttsSpeak(text: string): Promise<void> {
  return invoke("tts_speak", { text });
}

export async function ttsSetVoice(voice: string): Promise<void> {
  return invoke("tts_set_voice", { voice });
}

export async function ttsListVoices(): Promise<[string, string][]> {
  return invoke<[string, string][]>("tts_list_voices");
}

export function onDownloadProgress(callback: (progress: DownloadProgress) => void) {
  return listen<DownloadProgress>("model-download-progress", (e) => callback(e.payload));
}

export function onDownloadComplete(callback: (result: { success: boolean; tier?: string; cancelled?: boolean; error?: string }) => void) {
  return listen<{ success: boolean; tier?: string; cancelled?: boolean; error?: string }>("model-download-complete", (e) => callback(e.payload));
}

export async function startModelDownload(url: string, component: string, filename: string, tier: string): Promise<void> {
  return invoke("start_model_download", { url, component, filename, tier });
}

export async function cancelModelDownload(): Promise<void> {
  return invoke("cancel_model_download");
}

export function onPlaybackFinished(callback: () => void) {
  return listen<void>("playback-finished", () => callback());
}
