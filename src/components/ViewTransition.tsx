import { useRef, useState, useEffect, type ReactNode } from "react";

interface ViewTransitionProps {
  viewKey: string;
  themeId: string;
  disabled?: boolean;
  level?: string;
  animStyle?: string;
  children: ReactNode;
}

export function ViewTransition({ viewKey, themeId, disabled, level, animStyle, children }: ViewTransitionProps) {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const prevKey = useRef(viewKey);
  const [animating, setAnimating] = useState(false);
  const [settingsEnter, setSettingsEnter] = useState(false);

  useEffect(() => {
    if (viewKey !== prevKey.current) {
      prevKey.current = viewKey;
      if (!prefersReduced && !disabled) {
        if (viewKey === "settings") {
          // Settings uses a simple timed animation — no animationend dependency
          setSettingsEnter(true);
        } else {
          setAnimating(true);
        }
      }
    }
  }, [viewKey, prefersReduced, disabled]);

  // Settings: remove animation class after duration
  useEffect(() => {
    if (!settingsEnter) return;
    const timer = setTimeout(() => setSettingsEnter(false), 250);
    return () => clearTimeout(timer);
  }, [settingsEnter]);

  // If disabled changes while animating, stop immediately
  useEffect(() => {
    if (disabled && animating) setAnimating(false);
    if (disabled && settingsEnter) setSettingsEnter(false);
  }, [disabled, animating, settingsEnter]);

  // Fallback: clear animation class after timeout
  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setAnimating(false), 600);
    return () => clearTimeout(timer);
  }, [animating]);

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    if (e.target === e.currentTarget) {
      setAnimating(false);
      return;
    }
    if ((e.target as HTMLElement).parentElement === e.currentTarget) {
      setAnimating(false);
    }
  };

  const showAnimation = animating && !disabled;
  const showSettingsEnter = settingsEnter && !disabled;

  return (
    <div
      className={`view-transition-wrapper${showAnimation ? " view-entering" : ""}${showSettingsEnter ? " settings-entering" : ""}`}
      data-theme-transition={themeId}
      data-animation-level={!disabled && level && level !== "off" ? level : undefined}
      data-animation-style={!disabled && animStyle ? animStyle : undefined}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
}
