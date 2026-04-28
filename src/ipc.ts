import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppState, BeatEvent, Subdivision } from "./types";

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

export async function setCorner(corner: string): Promise<void> {
  return invoke("set_corner", { corner });
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  return invoke("set_always_on_top", { enabled });
}

export async function setAccentColor(color: string): Promise<void> {
  return invoke("set_accent_color", { color });
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
