import { useEffect, useRef } from 'react';

interface BackgroundAmbienceProps {
  gridEnabled: boolean;
  particlesEnabled: boolean;
  scanlineEnabled: boolean;
}

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  cyan: boolean;
}

export function BackgroundAmbience({
  gridEnabled,
  particlesEnabled,
  scanlineEnabled,
}: BackgroundAmbienceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!particlesEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const count = width < 768 ? 24 : 44;
    const particles: AmbientParticle[] = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -0.06 - Math.random() * 0.18,
      size: 0.8 + Math.random() * 1.4,
      alpha: 0.12 + Math.random() * 0.32,
      cyan: Math.random() > 0.25,
    }));

    let rafId = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        if (!reducedMotion) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.y < -10) p.y = height + 10;
          if (p.x < -10) p.x = width + 10;
          if (p.x > width + 10) p.x = -10;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.cyan
          ? `rgba(34, 211, 238, ${p.alpha})`
          : `rgba(186, 230, 253, ${p.alpha * 0.85})`;
        ctx.fill();
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [particlesEnabled]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {/* Deep obsidian & midnight electric-blue base gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 85% 62% at 50% 30%, rgba(16, 48, 96, 0.56) 0%, rgba(5, 14, 34, 0.88) 48%, #02050d 100%)',
        }}
      />

      {/* Ambient electric-blue, cyan and ice-blue central illumination */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 42%, rgba(34, 211, 238, 0.1) 0%, rgba(37, 99, 235, 0.06) 36%, transparent 68%)',
        }}
      />

      {/* Precision holographic grid with radial mask */}
      {gridEnabled && (
        <div
          className="absolute inset-0 opacity-[0.22]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(34, 211, 238, 0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 211, 238, 0.14) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage:
              'radial-gradient(ellipse 80% 72% at 50% 45%, rgba(0,0,0,0.9) 25%, transparent 82%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 80% 72% at 50% 45%, rgba(0,0,0,0.9) 25%, transparent 82%)',
          }}
        />
      )}

      {/* Subtle architectural energy lines */}
      <div className="absolute inset-x-0 top-14 h-px bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#02040a] to-transparent" />

      {/* Subtle holographic scanning sweep */}
      {scanlineEnabled && (
        <div className="absolute inset-x-0 top-0 h-44 chormo-scan bg-gradient-to-b from-transparent via-cyan-400/[0.035] to-transparent" />
      )}

      {/* Lightweight digital particles */}
      {particlesEnabled && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      )}
    </div>
  );
}
