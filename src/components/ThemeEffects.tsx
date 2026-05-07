import { useEffect, useRef } from "react";
import type { BeatEvent } from "../types";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  hue: number;
  ripple: number;
}

const PARTICLE_THEMES: Record<string, { hues: number[]; count: number; glow: string; glowMid: string; blend: string; glowRadius: number; particleLightness: number; particleBaseOpacity: number }> = {
  aurora: { hues: [190, 210, 280], count: 25, glow: "rgba(0, 212, 255, 0.4)", glowMid: "rgba(0, 212, 255, 0.12)", blend: "screen", glowRadius: 200, particleLightness: 70, particleBaseOpacity: 0.3 },
  prism:  { hues: [330, 280, 200, 30], count: 30, glow: "rgba(255, 61, 138, 0.5)", glowMid: "rgba(255, 61, 138, 0.15)", blend: "multiply", glowRadius: 130, particleLightness: 45, particleBaseOpacity: 0.6 },
};

export function ThemeEffects({ themeId, currentBeat, isPlaying }: { themeId: string; currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -200, y: -200 });
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const prevBeatRef = useRef(-1);
  const config = PARTICLE_THEMES[themeId];

  // Beat pulse — trigger ripple on downbeats
  useEffect(() => {
    if (!config || !isPlaying || !currentBeat) return;
    if (!currentBeat.isDownbeat) return;
    if (currentBeat.beat === prevBeatRef.current) return;
    prevBeatRef.current = currentBeat.beat;
    for (const p of particlesRef.current) {
      p.ripple = 0.3 + Math.random() * 0.25;
    }
  }, [currentBeat, isPlaying, config]);

  // Track mouse
  useEffect(() => {
    if (!config) return;
    const handleMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleLeave = () => {
      mouseRef.current = { x: -200, y: -200 };
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseleave", handleLeave);
    };
  }, [config]);

  // Canvas animation
  useEffect(() => {
    if (!config) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const makeParticle = (xRange: [number, number], yRange: [number, number]): Particle => ({
      x: xRange[0] + Math.random() * (xRange[1] - xRange[0]),
      y: yRange[0] + Math.random() * (yRange[1] - yRange[0]),
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2.5 + 1.5,
      opacity: Math.random() * config.particleBaseOpacity + config.particleBaseOpacity * 0.3,
      hue: config.hues[Math.floor(Math.random() * config.hues.length)],
      ripple: 0,
    });

    const TARGET_DENSITY = config.count / (window.innerWidth * window.innerHeight);

    const resize = () => {
      const prevW = canvas.width;
      const prevH = canvas.height;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // Spawn particles in newly exposed area
      if (canvas.width > prevW || canvas.height > prevH) {
        const newArea = canvas.width * canvas.height - prevW * prevH;
        const count = Math.max(0, Math.round(newArea * TARGET_DENSITY));
        for (let i = 0; i < count; i++) {
          if (canvas.width > prevW && Math.random() < (canvas.width - prevW) / (canvas.width - prevW + Math.max(0, canvas.height - prevH))) {
            particlesRef.current.push(makeParticle([prevW, canvas.width], [0, canvas.height]));
          } else {
            particlesRef.current.push(makeParticle([0, canvas.width], [prevH, canvas.height]));
          }
        }
      }
    };
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener("resize", resize);

    // Init particles
    particlesRef.current = Array.from({ length: config.count }, () =>
      makeParticle([0, canvas.width], [0, canvas.height])
    );

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { x: mx, y: my } = mouseRef.current;

      // Cursor glow
      if (mx > 0 && my > 0) {
        const r = config.glowRadius;
        const gradient = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        gradient.addColorStop(0, config.glow);
        gradient.addColorStop(0.4, config.glowMid);
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.fillRect(mx - r, my - r, r * 2, r * 2);
      }

      // Particles
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;

        // Gentle sway
        p.vx += (Math.random() - 0.5) * 0.01;
        p.vy += (Math.random() - 0.5) * 0.01;
        p.vx = Math.max(-0.4, Math.min(0.4, p.vx));
        p.vy = Math.max(-0.4, Math.min(0.4, p.vy));

        // Proximity glow: particles near cursor get brighter
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const boost = dist < 150 ? (1 - dist / 150) * 0.6 : 0;
        const beatPulse = p.ripple > 0.02 ? p.ripple : 0;
        const alpha = Math.min(1, p.opacity + boost + beatPulse * 0.4);
        const beatLight = config.particleLightness + beatPulse * 30;

        // Core particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + boost * 2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 85%, ${beatLight}%, ${alpha})`;
        ctx.fill();

        // Subtle glow ring
        if (alpha > 0.3) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3 + boost * 4, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 85%, ${beatLight}%, ${alpha * 0.2})`;
          ctx.fill();
        }

        // Beat ripple ring
        if (p.ripple > 0.02) {
          const rippleRadius = p.size + (14 * (1 - p.ripple));
          ctx.beginPath();
          ctx.arc(p.x, p.y, rippleRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${p.hue}, 85%, ${config.particleLightness}%, ${p.ripple * 0.35})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
          p.ripple *= 0.91;
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [config]);

  if (!config) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        mixBlendMode: config.blend as any,
      }}
    />
  );
}
