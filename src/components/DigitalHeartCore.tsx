import { useEffect, useRef } from 'react';
import type { AIState } from '../types/chat';

interface DigitalHeartCoreProps {
  state: AIState;
  audioLevelRef?: { current: number };
  size?: 'hero' | 'voice' | 'compact';
  onClick?: () => void;
  ariaLabel?: string;
}

interface CoreParticle {
  angle: number;
  distance: number;
  speed: number;
  radius: number;
  alpha: number;
  orbitTilt: number;
  iceBlue: boolean;
}

export function DigitalHeartCore({
  state,
  audioLevelRef,
  size = 'hero',
  onClick,
  ariaLabel,
}: DigitalHeartCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AIState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const particleCount = size === 'compact' ? 10 : 38;
    const particles: CoreParticle[] = Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      distance: 1.08 + Math.random() * 0.72,
      speed: (0.004 + Math.random() * 0.009) * (Math.random() > 0.3 ? 1 : -1),
      radius: size === 'compact' ? 0.8 + Math.random() * 0.9 : 1.0 + Math.random() * 1.8,
      alpha: 0.25 + Math.random() * 0.65,
      orbitTilt: 0.55 + Math.random() * 0.45,
      iceBlue: Math.random() > 0.45,
    }));

    let rafId = 0;
    let smoothedLevel = 0;
    let phase = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const drawFrame = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : size === 'compact' ? 36 : 300;
      const height = parent ? parent.clientHeight : size === 'compact' ? 36 : 300;
      const cx = width / 2;
      const cy = height / 2;
      const minDim = Math.min(width, height);

      const baseRadius =
        size === 'compact'
          ? Math.max(7, minDim * 0.24)
          : size === 'voice'
            ? Math.max(54, Math.min(104, minDim * 0.22))
            : Math.max(46, Math.min(84, minDim * 0.21));

      const currentState = stateRef.current;
      const rawLevel = audioLevelRef ? Math.max(0, Math.min(1, audioLevelRef.current)) : 0;

      // In listening/responding without external audio feed, synthesize subtle organic wave cadence
      const syntheticLevel =
        rawLevel > 0.01
          ? rawLevel
          : currentState === 'listening'
            ? 0.22 + Math.abs(Math.sin(phase * 2.1) * Math.cos(phase * 1.3)) * 0.35
            : currentState === 'responding'
              ? 0.28 + Math.abs(Math.sin(phase * 2.4) * Math.sin(phase * 1.15)) * 0.42
              : 0;

      smoothedLevel = smoothedLevel * 0.82 + syntheticLevel * 0.18;

      const speed =
        currentState === 'thinking'
          ? 0.058
          : currentState === 'responding'
            ? 0.042 + smoothedLevel * 0.025
            : currentState === 'listening'
              ? 0.032 + smoothedLevel * 0.02
              : 0.014;

      if (!reducedMotion) {
        phase += speed;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Deep holographic atmospheric halo
      const breath =
        currentState === 'responding'
          ? Math.sin(phase * 1.6) * (size === 'compact' ? 1 : 4.5) + smoothedLevel * (size === 'compact' ? 2 : 16)
          : currentState === 'listening'
            ? Math.sin(phase * 1.2) * (size === 'compact' ? 1 : 3.5) + smoothedLevel * (size === 'compact' ? 2 : 18)
            : currentState === 'thinking'
              ? Math.sin(phase * 2.4) * (size === 'compact' ? 1 : 4)
              : Math.sin(phase) * (size === 'compact' ? 0.6 : 2.5);

      const coreRadius = baseRadius + breath;

      const haloGrad = ctx.createRadialGradient(
        cx,
        cy,
        coreRadius * 0.3,
        cx,
        cy,
        coreRadius * (size === 'compact' ? 2.1 : 2.6)
      );

      if (currentState === 'listening') {
        haloGrad.addColorStop(0, `rgba(34, 211, 238, ${0.34 + smoothedLevel * 0.28})`);
        haloGrad.addColorStop(0.42, `rgba(56, 189, 248, ${0.16 + smoothedLevel * 0.12})`);
        haloGrad.addColorStop(1, 'rgba(3, 6, 15, 0)');
      } else if (currentState === 'thinking') {
        haloGrad.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
        haloGrad.addColorStop(0.42, 'rgba(59, 130, 246, 0.18)');
        haloGrad.addColorStop(1, 'rgba(3, 6, 15, 0)');
      } else if (currentState === 'responding') {
        haloGrad.addColorStop(0, `rgba(103, 232, 249, ${0.32 + smoothedLevel * 0.24})`);
        haloGrad.addColorStop(0.45, `rgba(14, 165, 233, ${0.16 + smoothedLevel * 0.14})`);
        haloGrad.addColorStop(1, 'rgba(3, 6, 15, 0)');
      } else {
        haloGrad.addColorStop(0, 'rgba(34, 211, 238, 0.22)');
        haloGrad.addColorStop(0.5, 'rgba(14, 116, 144, 0.1)');
        haloGrad.addColorStop(1, 'rgba(3, 6, 15, 0)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * (size === 'compact' ? 2.1 : 2.6), 0, Math.PI * 2);
      ctx.fillStyle = haloGrad;
      ctx.fill();

      // 2. Dynamic sound / energy wave rings
      if (size !== 'compact') {
        const waveCount = currentState === 'idle' ? 2 : 3;
        for (let w = 0; w < waveCount; w++) {
          const progress = (phase * 0.22 + w / waveCount) % 1;
          const expandFactor =
            currentState === 'listening'
              ? 1.12 + progress * (0.9 + smoothedLevel * 0.55)
              : currentState === 'responding'
                ? 1.12 + progress * (0.85 + smoothedLevel * 0.5)
                : currentState === 'thinking'
                  ? 1.15 + progress * 0.65
                  : 1.12 + progress * 0.45;

          const waveAlpha =
            (1 - progress) *
            (currentState === 'listening'
              ? 0.44 + smoothedLevel * 0.28
              : currentState === 'responding'
                ? 0.4 + smoothedLevel * 0.28
                : currentState === 'thinking'
                  ? 0.34
                  : 0.18);

          ctx.beginPath();
          const steps = 84;
          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const ripple =
              currentState === 'listening'
                ? Math.sin(angle * 5 - phase * 2.8 + w) * (2.2 + smoothedLevel * 9)
                : currentState === 'responding'
                  ? Math.sin(angle * 4 + phase * 3.1 + w) * (2.4 + smoothedLevel * 10) +
                    Math.cos(angle * 2 - phase * 2) * (1.2 + smoothedLevel * 4)
                  : currentState === 'thinking'
                    ? Math.sin(angle * 6 + phase * 3.8 + w) * 2.6
                    : Math.sin(angle * 3 + phase) * 1.0;

            const r = baseRadius * expandFactor + ripple;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle =
            w % 2 === 0
              ? `rgba(34, 211, 238, ${waveAlpha})`
              : `rgba(125, 211, 252, ${waveAlpha * 0.85})`;
          ctx.lineWidth = currentState === 'idle' ? 1.1 : 1.5;
          ctx.stroke();
        }
      }

      // 3. Precision holographic segmented orbital arcs (Canvas layer)
      const arcMultiplier = size === 'compact' ? 1.45 : 1.38;
      const arcCount = size === 'compact' ? 2 : 3;
      for (let a = 0; a < arcCount; a++) {
        const ringRadius = coreRadius * (arcMultiplier + a * (size === 'compact' ? 0.32 : 0.24));
        const direction = a % 2 === 0 ? 1 : -1;
        const speedBoost =
          currentState === 'thinking'
            ? 2.2
            : currentState === 'responding'
              ? 1.5
              : currentState === 'listening'
                ? 1.3
                : 0.7;
        const startAngle = phase * direction * speedBoost * (0.7 + a * 0.25) + a * 1.4;
        const span = Math.PI * (a === 0 ? 0.72 : a === 1 ? 0.55 : 0.42);

        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, startAngle, startAngle + span);
        ctx.strokeStyle =
          a === 0
            ? 'rgba(34, 211, 238, 0.72)'
            : a === 1
              ? 'rgba(186, 230, 253, 0.52)'
              : 'rgba(14, 165, 233, 0.42)';
        ctx.lineWidth = size === 'compact' ? 1.3 : 1.8;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Opposite counter-arc for symmetrical JARVIS HUD feel
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, startAngle + Math.PI, startAngle + Math.PI + span * 0.75);
        ctx.strokeStyle =
          a === 0 ? 'rgba(56, 189, 248, 0.38)' : 'rgba(103, 232, 249, 0.28)';
        ctx.lineWidth = size === 'compact' ? 1.0 : 1.25;
        ctx.stroke();
      }

      // 4. Orbiting digital energy particles
      for (const p of particles) {
        if (!reducedMotion) {
          const pBoost =
            currentState === 'thinking'
              ? 2.6
              : currentState === 'responding'
                ? 1.7 + smoothedLevel * 1.4
                : currentState === 'listening'
                  ? 1.3 + smoothedLevel
                  : 0.7;
          p.angle += p.speed * pBoost;
        }

        const orbitDist = coreRadius * p.distance;
        const px = cx + Math.cos(p.angle) * orbitDist;
        const py = cy + Math.sin(p.angle) * orbitDist * p.orbitTilt;

        ctx.beginPath();
        ctx.arc(px, py, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.iceBlue
          ? `rgba(186, 230, 253, ${p.alpha})`
          : `rgba(34, 211, 238, ${p.alpha})`;
        ctx.fill();
      }

      // 5. Central 3D Holographic AI Heart Core
      ctx.save();
      ctx.beginPath();
      const spherePoints = size === 'compact' ? 40 : 80;
      for (let i = 0; i <= spherePoints; i++) {
        const angle = (i / spherePoints) * Math.PI * 2;
        const deform =
          currentState === 'responding'
            ? Math.sin(angle * 4 + phase * 3.2) * (1.2 + smoothedLevel * 4.2)
            : currentState === 'listening'
              ? Math.sin(angle * 3 + phase * 2.4) * (1.0 + smoothedLevel * 3.6)
              : currentState === 'thinking'
                ? Math.sin(angle * 6 - phase * 3.5) * 1.5
                : Math.sin(angle * 2 + phase) * 0.55;

        const r = coreRadius + (size === 'compact' ? deform * 0.25 : deform);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const lightX = cx - coreRadius * 0.3 + Math.cos(phase * 0.7) * (coreRadius * 0.08);
      const lightY = cy - coreRadius * 0.34 + Math.sin(phase * 0.7) * (coreRadius * 0.08);

      const sphereGrad = ctx.createRadialGradient(
        lightX,
        lightY,
        coreRadius * 0.06,
        cx,
        cy,
        coreRadius * 1.08
      );

      if (currentState === 'listening') {
        sphereGrad.addColorStop(0, '#F0F9FF');
        sphereGrad.addColorStop(0.22, '#67E8F9');
        sphereGrad.addColorStop(0.55, '#06B6D4');
        sphereGrad.addColorStop(0.86, '#0369A1');
        sphereGrad.addColorStop(1, '#082F49');
      } else if (currentState === 'thinking') {
        sphereGrad.addColorStop(0, '#E0F2FE');
        sphereGrad.addColorStop(0.24, '#38BDF8');
        sphereGrad.addColorStop(0.58, '#2563EB');
        sphereGrad.addColorStop(0.88, '#1D4ED8');
        sphereGrad.addColorStop(1, '#0F172A');
      } else if (currentState === 'responding') {
        sphereGrad.addColorStop(0, '#FFFFFF');
        sphereGrad.addColorStop(0.2, '#A5F3FC');
        sphereGrad.addColorStop(0.52, '#22D3EE');
        sphereGrad.addColorStop(0.84, '#0284C7');
        sphereGrad.addColorStop(1, '#0C4A6E');
      } else {
        sphereGrad.addColorStop(0, '#E0F2FE');
        sphereGrad.addColorStop(0.25, '#38BDF8');
        sphereGrad.addColorStop(0.62, '#0284C7');
        sphereGrad.addColorStop(0.9, '#0C4A6E');
        sphereGrad.addColorStop(1, '#06152B');
      }

      ctx.fillStyle = sphereGrad;
      ctx.fill();
      ctx.clip();

      // Internal aurora plasma ribbons
      for (let k = 0; k < 2; k++) {
        const rx = cx + Math.cos(phase * (1.0 + k * 0.45) + k * 2.1) * coreRadius * 0.36;
        const ry = cy + Math.sin(phase * (0.85 + k * 0.35) + k * 2.1) * coreRadius * 0.36;
        const ribbonGrad = ctx.createRadialGradient(rx, ry, 1, cx, cy, coreRadius * 0.92);
        ribbonGrad.addColorStop(
          0,
          k === 0 ? 'rgba(165, 243, 252, 0.58)' : 'rgba(56, 189, 248, 0.45)'
        );
        ribbonGrad.addColorStop(1, 'rgba(2, 132, 199, 0)');
        ctx.fillStyle = ribbonGrad;
        ctx.fillRect(
          cx - coreRadius - 8,
          cy - coreRadius - 8,
          coreRadius * 2 + 16,
          coreRadius * 2 + 16
        );
      }

      // Inner glowing energy nucleus (AI Heart center)
      const nucleusRadius =
        coreRadius *
        (currentState === 'responding'
          ? 0.28 + smoothedLevel * 0.12
          : currentState === 'thinking'
            ? 0.3 + Math.sin(phase * 3) * 0.04
            : 0.24);
      const nucleusGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusRadius * 2);
      nucleusGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      nucleusGrad.addColorStop(0.45, 'rgba(103, 232, 249, 0.65)');
      nucleusGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
      ctx.fillStyle = nucleusGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusRadius * 2, 0, Math.PI * 2);
      ctx.fill();

      // Subtle holographic scan beam passing across the core
      if (size !== 'compact' && !reducedMotion) {
        const scanProgress = ((phase * 0.28) % 2) - 1;
        const scanY = cy + scanProgress * coreRadius;
        const scanGrad = ctx.createLinearGradient(cx, scanY - 8, cx, scanY + 8);
        scanGrad.addColorStop(0, 'rgba(165, 243, 252, 0)');
        scanGrad.addColorStop(0.5, 'rgba(224, 242, 254, 0.28)');
        scanGrad.addColorStop(1, 'rgba(165, 243, 252, 0)');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(cx - coreRadius, scanY - 8, coreRadius * 2, 16);
      }

      ctx.restore();

      // Crisp luminous core rim
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx.strokeStyle =
        currentState === 'listening' || currentState === 'responding'
          ? 'rgba(165, 243, 252, 0.62)'
          : 'rgba(125, 211, 252, 0.38)';
      ctx.lineWidth = size === 'compact' ? 0.9 : 1.3;
      ctx.stroke();

      rafId = window.requestAnimationFrame(drawFrame);
    };

    rafId = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [audioLevelRef, size]);

  const isInteractive = Boolean(onClick);
  const ringSpeedOuter =
    state === 'thinking' ? 'chormo-ring-fast-cw' : 'chormo-ring-cw';
  const ringSpeedInner =
    state === 'thinking' ? 'chormo-ring-fast-ccw' : 'chormo-ring-ccw';

  if (size === 'compact') {
    return (
      <div
        onClick={onClick}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={ariaLabel}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
        className={`relative w-9 h-9 shrink-0 flex items-center justify-center ${
          isInteractive ? 'cursor-pointer' : ''
        }`}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={ariaLabel || 'CHORMO AI Digital Core'}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={[
        'relative w-full h-full flex items-center justify-center select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 rounded-full',
        isInteractive ? 'cursor-pointer group' : '',
      ].join(' ')}
    >
      {/* Precision SVG holographic outer dial overlays */}
      <svg
        viewBox="0 0 320 320"
        fill="none"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 w-full h-full transition-opacity duration-300 ${ringSpeedOuter} ${
          state === 'listening' || state === 'responding' ? 'opacity-90' : 'opacity-65 group-hover:opacity-90'
        }`}
      >
        <circle
          cx="160"
          cy="160"
          r="148"
          stroke="rgba(34, 211, 238, 0.16)"
          strokeWidth="1"
          strokeDasharray="3 9"
        />
        <circle
          cx="160"
          cy="160"
          r="134"
          stroke="rgba(56, 189, 248, 0.24)"
          strokeWidth="1.1"
          strokeDasharray="42 24 8 24"
        />
        <path
          d="M160 12V24M160 296V308M12 160H24M296 160H308"
          stroke="rgba(103, 232, 249, 0.45)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>

      <svg
        viewBox="0 0 320 320"
        fill="none"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 w-full h-full transition-opacity duration-300 ${ringSpeedInner} ${
          state === 'thinking' ? 'opacity-95' : 'opacity-60 group-hover:opacity-85'
        }`}
      >
        <circle
          cx="160"
          cy="160"
          r="116"
          stroke="rgba(125, 211, 252, 0.24)"
          strokeWidth="1"
          strokeDasharray="18 14 4 14"
        />
        <circle
          cx="160"
          cy="160"
          r="98"
          stroke="rgba(34, 211, 238, 0.2)"
          strokeWidth="0.9"
          strokeDasharray="6 10"
        />
      </svg>

      <canvas ref={canvasRef} className="relative z-10 w-full h-full block" />
    </div>
  );
}
