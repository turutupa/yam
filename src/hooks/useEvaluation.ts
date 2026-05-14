import { useState, useEffect, useRef, useCallback } from "react";
import {
  listAudioInputDevices,
  startEvaluation,
  stopEvaluation,
  getEvaluationState,
  onAudioSpectrum,
  onAudioInputDevicesChanged,
  onBeatFeedback,
  storeLoad,
  storeSave,
} from "../ipc";
import type { AudioInputDevice, AudioSpectrum, BeatFeedback } from "../types";

/** Colors matching feedback classifications — reads theme CSS vars */
export const FEEDBACK_COLORS = {
  get perfect() { return getComputedStyle(document.documentElement).getPropertyValue("--feedback-perfect").trim() || "#10b981"; },
  get good() { return getComputedStyle(document.documentElement).getPropertyValue("--feedback-good").trim() || "#06b6d4"; },
  get ok() { return getComputedStyle(document.documentElement).getPropertyValue("--feedback-ok").trim() || "#f59e0b"; },
  get miss() { return getComputedStyle(document.documentElement).getPropertyValue("--feedback-miss").trim() || "#6b7280"; },
  skipped: "transparent",
};

export function useEvaluation() {
  const [enabled, setEnabled] = useState(false);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | undefined>(undefined);
  const [spectrum, setSpectrum] = useState<AudioSpectrum | null>(null);
  const [showRealtime, setShowRealtime] = useState(true);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Beat feedback tracking
  const [lastFeedback, setLastFeedback] = useState<BeatFeedback | null>(null);
  const [dotFeedback, setDotFeedback] = useState<Map<number, BeatFeedback>>(new Map());
  const [recentDeviations, setRecentDeviations] = useState<number[]>([]);
  const feedbackUnlistenRef = useRef<(() => void) | null>(null);

  // Load saved preferences on mount
  useEffect(() => {
    (async () => {
      const savedDevice = await storeLoad<string>("evaluationDevice");
      if (savedDevice) setSelectedDevice(savedDevice);
      const savedRealtime = await storeLoad<boolean>("evaluationShowRealtime");
      if (savedRealtime !== undefined) setShowRealtime(savedRealtime);
    })();
  }, []);

  // Subscribe to spectrum events when enabled
  useEffect(() => {
    if (!enabled) {
      setSpectrum(null);
      return;
    }
    let cancelled = false;
    onAudioSpectrum((s) => {
      if (!cancelled) setSpectrum(s);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });
    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [enabled]);

  // Subscribe to beat-feedback events when enabled
  useEffect(() => {
    if (!enabled) {
      setLastFeedback(null);
      setDotFeedback(new Map());
      setRecentDeviations([]);
      return;
    }
    let cancelled = false;
    onBeatFeedback((fb) => {
      if (cancelled) return;
      setLastFeedback(fb);
      // Update dot feedback map (keyed by beat position in measure — set by consumer)
      setDotFeedback((prev) => {
        const next = new Map(prev);
        next.set(fb.beatIndex, fb);
        return next;
      });
      // Track recent deviations for drift meter (skip misses and skipped)
      if (fb.classification !== "miss" && fb.classification !== "skipped") {
        setRecentDeviations((prev) => {
          const next = [...prev, fb.deviationMs];
          return next.slice(-16); // keep last 16
        });
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        feedbackUnlistenRef.current = unlisten;
      }
    });
    return () => {
      cancelled = true;
      if (feedbackUnlistenRef.current) {
        feedbackUnlistenRef.current();
        feedbackUnlistenRef.current = null;
      }
    };
  }, [enabled]);

  // Sync with backend state on mount
  useEffect(() => {
    getEvaluationState().then(setEnabled);
    listAudioInputDevices().then(setDevices);
    const unlisten = onAudioInputDevicesChanged(setDevices);
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const refreshDevices = useCallback(async () => {
    const devs = await listAudioInputDevices();
    setDevices(devs);
    return devs;
  }, []);

  const toggle = useCallback(async () => {
    if (enabled) {
      await stopEvaluation();
      setEnabled(false);
    } else {
      await refreshDevices();
      await startEvaluation(selectedDevice);
      setEnabled(true);
    }
  }, [enabled, selectedDevice, refreshDevices]);

  const selectDevice = useCallback(async (deviceName: string) => {
    setSelectedDevice(deviceName);
    await storeSave("evaluationDevice", deviceName);
    // If currently active, restart with new device
    if (enabled) {
      await stopEvaluation();
      await startEvaluation(deviceName);
    }
  }, [enabled]);

  const toggleRealtime = useCallback(async () => {
    const next = !showRealtime;
    setShowRealtime(next);
    await storeSave("evaluationShowRealtime", next);
  }, [showRealtime]);

  // Signal detection: true if any band has meaningful energy
  const hasSignal = spectrum != null && spectrum.rms > 0.01;

  // Average recent deviation for drift meter
  const avgDeviation = recentDeviations.length > 0
    ? recentDeviations.reduce((a, b) => a + b, 0) / recentDeviations.length
    : 0;

  return {
    enabled,
    toggle,
    devices,
    refreshDevices,
    selectedDevice,
    selectDevice,
    spectrum,
    hasSignal,
    showRealtime,
    toggleRealtime,
    // Beat feedback
    lastFeedback,
    dotFeedback,
    recentDeviations,
    avgDeviation,
  };
}
