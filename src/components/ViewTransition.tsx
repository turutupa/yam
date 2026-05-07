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

  useEffect(() => {
    if (viewKey !== prevKey.current) {
      prevKey.current = viewKey;
      if (!prefersReduced && !disabled) {
        setAnimating(true);
      }
    }
  }, [viewKey, prefersReduced, disabled]);

  // If disabled changes while animating, stop immediately
  useEffect(() => {
    if (disabled && animating) setAnimating(false);
  }, [disabled, animating]);

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    // Only respond to animations on direct children, not nested elements
    if (e.target === e.currentTarget) return;
    if ((e.target as HTMLElement).parentElement === e.currentTarget) {
      setAnimating(false);
    }
  };

  // Double-guard: never show animation class when disabled
  const showAnimation = animating && !disabled;

  return (
    <div
      className={`view-transition-wrapper${showAnimation ? " view-entering" : ""}`}
      data-theme-transition={themeId}
      data-animation-level={!disabled && level && level !== "off" ? level : undefined}
      data-animation-style={!disabled && animStyle ? animStyle : undefined}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
}
