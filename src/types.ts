export type Subdivision = 1 | 2 | 3 | 4 | 5 | 6;
export type WidgetMode = "compact" | "comfortable";
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type AppState = {
  bpm: number;
  isPlaying: boolean;
  subdivision: Subdivision;
  mode: WidgetMode;
  corner: Corner;
  alwaysOnTop: boolean;
  accentColor: string;
  volume: number;
  soundType: string;
  timeSignature: number;
};

export type BeatEvent = {
  beat: number;
  subdivision: number;
  isDownbeat: boolean;
};
