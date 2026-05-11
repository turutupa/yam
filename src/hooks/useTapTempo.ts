import { useCallback, useRef, useState } from "react";

export function useTapTempo(onBpmDetected: (bpm: number) => void) {
  const tapsRef = useRef<number[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [tapCount, setTapCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const tap = useCallback(() => {
    const now = performance.now();
    const taps = tapsRef.current;

    // Reset if >2s since last tap
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      taps.length = 0;
    }

    taps.push(now);
    if (taps.length > 8) taps.shift();
    setTapCount(taps.length);
    setIsActive(true);

    if (taps.length >= 2) {
      // Compute intervals
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      // Median-based outlier rejection
      const sorted = intervals.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const filtered = intervals.filter(
        (iv) => iv > median * 0.5 && iv < median * 2,
      );
      if (filtered.length > 0) {
        const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
        const bpm = Math.round(60000 / avg);
        onBpmDetected(Math.max(20, Math.min(300, bpm)));
      }
    }

    // Auto-reset after 2s of no taps
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      tapsRef.current.length = 0;
      setTapCount(0);
      setIsActive(false);
    }, 2000);
  }, [onBpmDetected]);

  const reset = useCallback(() => {
    tapsRef.current.length = 0;
    setTapCount(0);
    setIsActive(false);
    clearTimeout(timeoutRef.current);
  }, []);

  return { tap, tapCount, isActive, reset };
}
