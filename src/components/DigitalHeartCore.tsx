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

interface CircuitBranch {
  angle: number;
  startFactor: number;
  bendFactor: number;
  endFactor: number;
  bendDelta: number;
  pulseOffset: number;
  hasSecondaryNode: boolean;
}

const CIRCUIT_ANGLES = [
  0,
  Math.PI / 6,
  Math.PI / 3,
  Math.PI / 2,
  (2 * Math.PI) / 3,
  (5 * Math.PI) / 6,
  Math.PI,
  (7 * Math.PI) / 6,
  (4 * Math.PI) / 3,
  (3 * Math.PI) / 2,
  (5 * Math.PI) / 3,
  (11 * Math.PI) / 6,
];

const CIRCUITS: CircuitBranch[] = CIRCUIT_ANGLES.map((angle, idx) => ({
  angle,
  startFactor: 1.04,
  bendFactor: idx % 2 === 0 ? 1.36 : 1.28,
  endFactor: idx % 3 === 0 ? 1.72 : idx % 2 === 0 ? 1.62 : 1.5,
  bendDelta: (idx % 2 === 0 ? 1 : -1) * 0.14,
  pulseOffset: (idx * 0.19) % 1,
  hasSecondaryNode: idx % 2 === 0,
}));

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

    const particleCount = size === 'compact' ? 10 : 52;
    const particles: CoreParticle[] = Array.from({ length: particleCount }, (_, i) => ({
      angle: (i / particleCount) * Math.PI * 2 + Math.random() * 0.4,
      distance: 1.12 + Math.random() * 0.78,
      speed: (0.003 + Math.random() * 0.0075) * (i % 3 === 0 ? -1 : 1),
      radius: size === 'compact' ? 0.7 + Math.random() * 0.8 : 0.9 + Math.random() * 1.9,
      alpha: 0.28 + Math.random() * 0.65,
      orbitTilt: 0.62 + Math.random() * 0.38,
      iceBlue: i % 2 === 0,
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
    const parentEl = canvas.parentElement;
    const ro =
      typeof ResizeObserver !== 'undefined' && parentEl
        ? new ResizeObserver(() => resize())
        : null;
    if (ro && parentEl) {
      ro.observe(parentEl);
    }

    const drawFrame = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : size === 'compact' ? 36 : 340;
      const height = parent ? parent.clientHeight : size === 'compact' ? 36 : 340;
      const cx = width / 2;
      const cy = height / 2;
      const minDim = Math.min(width, height);

      const baseRadius =
        size === 'compact'
          ? Math.max(7, minDim * 0.24)
          : size === 'voice'
            ? Math.max(54, Math.min(96, minDim * 0.21))
            : Math.max(46, Math.min(82, minDim * 0.2));

      const currentState = stateRef.current;
      const rawLevel = audioLevelRef ? Math.max(0, Math.min(1, audioLevelRef.current)) : 0;

      const syntheticLevel =
        rawLevel > 0.01
          ? rawLevel
          : currentState === 'listening'
            ? 0.24 + Math.abs(Math.sin(phase * 2.1) * Math.cos(phase * 1.3)) * 0.36
            : currentState === 'responding'
              ? 0.3 + Math.abs(Math.sin(phase * 2.5) * Math.sin(phase * 1.15)) * 0.44
              : 0;

      smoothedLevel = smoothedLevel * 0.8 + syntheticLevel * 0.2;

      const speed =
        currentState === 'thinking'
          ? 0.056
          : currentState === 'responding'
            ? 0.044 + smoothedLevel * 0.024
            : currentState === 'listening'
              ? 0.032 + smoothedLevel * 0.02
              : 0.014;

      if (!reducedMotion) {
        phase += speed;
      }

      ctx.clearRect(0, 0, width, height);

      const breath =
        currentState === 'responding'
          ? Math.sin(phase * 1.6) * (size === 'compact' ? 1 : 4.2) + smoothedLevel * (size === 'compact' ? 2 : 14)
          : currentState === 'listening'
            ? Math.sin(phase * 1.2) * (size === 'compact' ? 1 : 3.4) + smoothedLevel * (size === 'compact' ? 2 : 16)
            : currentState === 'thinking'
              ? Math.sin(phase * 2.5) * (size === 'compact' ? 1 : 3.8)
              : Math.sin(phase) * (size === 'compact' ? 0.6 : 2.2);

      const coreRadius = baseRadius + breath;

      // 1. Deep Electric-Blue & Cyan Volumetric Outer Halo
      const haloRadius = coreRadius * (size === 'compact' ? 2.15 : 2.65);
      const haloGrad = ctx.createRadialGradient(cx, cy, coreRadius * 0.25, cx, cy, haloRadius);

      if (currentState === 'listening') {
        haloGrad.addColorStop(0, `rgba(34, 211, 238, ${0.4 + smoothedLevel * 0.28})`);
        haloGrad.addColorStop(0.4, `rgba(59, 130, 246, ${0.22 + smoothedLevel * 0.12})`);
        haloGrad.addColorStop(0.75, 'rgba(14, 165, 233, 0.06)');
        haloGrad.addColorStop(1, 'rgba(2, 6, 18, 0)');
      } else if (currentState === 'thinking') {
        haloGrad.addColorStop(0, 'rgba(56, 189, 248, 0.42)');
        haloGrad.addColorStop(0.42, 'rgba(37, 99, 235, 0.24)');
        haloGrad.addColorStop(0.76, 'rgba(34, 211, 238, 0.07)');
        haloGrad.addColorStop(1, 'rgba(2, 6, 18, 0)');
      } else if (currentState === 'responding') {
        haloGrad.addColorStop(0, `rgba(186, 230, 253, ${0.42 + smoothedLevel * 0.24})`);
        haloGrad.addColorStop(0.38, `rgba(34, 211, 238, ${0.24 + smoothedLevel * 0.14})`);
        haloGrad.addColorStop(0.72, 'rgba(37, 99, 235, 0.08)');
        haloGrad.addColorStop(1, 'rgba(2, 6, 18, 0)');
      } else {
        haloGrad.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
        haloGrad.addColorStop(0.45, 'rgba(37, 99, 235, 0.14)');
        haloGrad.addColorStop(0.78, 'rgba(14, 116, 144, 0.04)');
        haloGrad.addColorStop(1, 'rgba(2, 6, 18, 0)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      ctx.fillStyle = haloGrad;
      ctx.fill();

      // 2. 360° Holographic Radar Scanning Wedge (Hero & Voice)
      if (size !== 'compact' && !reducedMotion) {
        const sweepSpeed = currentState === 'thinking' ? 1.55 : currentState === 'listening' ? 0.95 : 0.45;
        const sweepStart = phase * sweepSpeed;
        const sweepSpan = currentState === 'thinking' ? 0.85 : 0.55;
        const sweepOuter = coreRadius * 1.95;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, sweepOuter, sweepStart, sweepStart + sweepSpan);
        ctx.closePath();

        const sweepGrad = ctx.createRadialGradient(cx, cy, coreRadius * 0.9, cx, cy, sweepOuter);
        sweepGrad.addColorStop(0, 'rgba(34, 211, 238, 0.02)');
        sweepGrad.addColorStop(0.55, currentState === 'thinking' ? 'rgba(59, 130, 246, 0.16)' : 'rgba(34, 211, 238, 0.11)');
        sweepGrad.addColorStop(1, 'rgba(186, 230, 253, 0)');
        ctx.fillStyle = sweepGrad;
        ctx.fill();

        // Crisp leading scanner ray
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(sweepStart + sweepSpan) * coreRadius * 1.03, cy + Math.sin(sweepStart + sweepSpan) * coreRadius * 1.03);
        ctx.lineTo(cx + Math.cos(sweepStart + sweepSpan) * sweepOuter, cy + Math.sin(sweepStart + sweepSpan) * sweepOuter);
        ctx.strokeStyle = currentState === 'thinking' ? 'rgba(186, 230, 253, 0.45)' : 'rgba(103, 232, 249, 0.32)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
      }

      // 3. Glowing Radial Circuit Pathways & Traveling Energy Pulses (Hero & Voice)
      if (size !== 'compact') {
        const circuitRotation = phase * (currentState === 'thinking' ? 0.12 : 0.04);
        const pulseSpeed = currentState === 'thinking' ? 0.65 : currentState === 'responding' ? 0.5 : 0.25;

        for (let idx = 0; idx < CIRCUITS.length; idx++) {
          const c = CIRCUITS[idx];
          const a0 = c.angle + circuitRotation;
          const a1 = a0 + c.bendDelta;

          const x0 = cx + Math.cos(a0) * coreRadius * c.startFactor;
          const y0 = cy + Math.sin(a0) * coreRadius * c.startFactor;
          const x1 = cx + Math.cos(a0) * coreRadius * c.bendFactor;
          const y1 = cy + Math.sin(a0) * coreRadius * c.bendFactor;
          const x2 = cx + Math.cos(a1) * coreRadius * c.endFactor;
          const y2 = cy + Math.sin(a1) * coreRadius * c.endFactor;

          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle =
            currentState === 'thinking' || currentState === 'responding'
              ? 'rgba(56, 189, 248, 0.34)'
              : 'rgba(34, 211, 238, 0.2)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Terminal glowing circuit node
          ctx.beginPath();
          ctx.arc(x2, y2, c.hasSecondaryNode ? 2.1 : 1.5, 0, Math.PI * 2);
          ctx.fillStyle = c.hasSecondaryNode
            ? 'rgba(186, 230, 253, 0.72)'
            : 'rgba(34, 211, 238, 0.55)';
          ctx.fill();

          // Traveling data/energy packet along circuit trace
          if (!reducedMotion) {
            const rawT = (phase * pulseSpeed + c.pulseOffset) % 1;
            const t = currentState === 'listening' ? 1 - rawT : rawT;
            const px =
              t < 0.5
                ? x0 + (x1 - x0) * (t * 2)
                : x1 + (x2 - x1) * ((t - 0.5) * 2);
            const py =
              t < 0.5
                ? y0 + (y1 - y0) * (t * 2)
                : y1 + (y2 - y1) * ((t - 0.5) * 2);

            ctx.beginPath();
            ctx.arc(px, py, currentState === 'idle' ? 1.5 : 2.1, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(224, 242, 254, 0.9)';
            ctx.fill();
          }
        }
      }

      // 4. Concentric Acoustic & Energy Wave Rings
      if (size !== 'compact') {
        const waveCount = currentState === 'idle' ? 2 : 3;
        for (let w = 0; w < waveCount; w++) {
          const progress = (phase * 0.24 + w / waveCount) % 1;
          const expandFactor =
            currentState === 'listening'
              ? 1.12 + progress * (0.92 + smoothedLevel * 0.58)
              : currentState === 'responding'
                ? 1.12 + progress * (0.9 + smoothedLevel * 0.52)
                : currentState === 'thinking'
                  ? 1.14 + progress * 0.72
                  : 1.12 + progress * 0.5;

          const waveAlpha =
            (1 - progress) *
            (currentState === 'listening'
              ? 0.48 + smoothedLevel * 0.3
              : currentState === 'responding'
                ? 0.45 + smoothedLevel * 0.3
                : currentState === 'thinking'
                  ? 0.36
                  : 0.2);

          ctx.beginPath();
          const steps = 88;
          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const ripple =
              currentState === 'listening'
                ? Math.sin(angle * 5 - phase * 2.9 + w) * (2.2 + smoothedLevel * 9.5)
                : currentState === 'responding'
                  ? Math.sin(angle * 4 + phase * 3.2 + w) * (2.5 + smoothedLevel * 10.5) +
                    Math.cos(angle * 2 - phase * 2.1) * (1.2 + smoothedLevel * 4.2)
                  : currentState === 'thinking'
                    ? Math.sin(angle * 6 + phase * 3.8 + w) * 2.8
                    : Math.sin(angle * 3 + phase) * 1.1;

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
              : `rgba(186, 230, 253, ${waveAlpha * 0.85})`;
          ctx.lineWidth = currentState === 'idle' ? 1.1 : 1.5;
          ctx.stroke();
        }
      }

      // 5. Rotating Transparent Holographic Segmented Rings (Canvas layer)
      const arcMultiplier = size === 'compact' ? 1.45 : 1.32;
      const arcCount = size === 'compact' ? 2 : 4;
      for (let a = 0; a < arcCount; a++) {
        const ringRadius = coreRadius * (arcMultiplier + a * (size === 'compact' ? 0.32 : 0.2));
        const direction = a % 2 === 0 ? 1 : -1;
        const speedBoost =
          currentState === 'thinking'
            ? 2.25
            : currentState === 'responding'
              ? 1.55
              : currentState === 'listening'
                ? 1.3
                : 0.72;
        const startAngle = phase * direction * speedBoost * (0.65 + a * 0.22) + a * 1.3;
        const span = Math.PI * (a === 0 ? 0.74 : a === 1 ? 0.56 : a === 2 ? 0.44 : 0.34);

        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, startAngle, startAngle + span);
        ctx.strokeStyle =
          a === 0
            ? 'rgba(34, 211, 238, 0.78)'
            : a === 1
              ? 'rgba(186, 230, 253, 0.56)'
              : a === 2
                ? 'rgba(59, 130, 246, 0.52)'
                : 'rgba(103, 232, 249, 0.38)';
        ctx.lineWidth = size === 'compact' ? 1.25 : a % 2 === 0 ? 1.9 : 1.25;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Symmetrical counter-arc
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, startAngle + Math.PI, startAngle + Math.PI + span * 0.75);
        ctx.strokeStyle =
          a === 0
            ? 'rgba(56, 189, 248, 0.44)'
            : a === 1
              ? 'rgba(103, 232, 249, 0.32)'
              : 'rgba(37, 99, 235, 0.34)';
        ctx.lineWidth = size === 'compact' ? 0.95 : 1.2;
        ctx.stroke();
      }

      // 6. Orbiting Ice-Blue & Cyan Digital Particles
      for (const p of particles) {
        if (!reducedMotion) {
          const pBoost =
            currentState === 'thinking'
              ? 2.5
              : currentState === 'responding'
                ? 1.7 + smoothedLevel * 1.35
                : currentState === 'listening'
                  ? 1.3 + smoothedLevel
                  : 0.72;
          p.angle += p.speed * pBoost;
        }

        const orbitDist = coreRadius * p.distance;
        const px = cx + Math.cos(p.angle) * orbitDist;
        const py = cy + Math.sin(p.angle) * orbitDist * p.orbitTilt;

        ctx.beginPath();
        ctx.arc(px, py, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.iceBlue
          ? `rgba(224, 242, 254, ${p.alpha})`
          : `rgba(34, 211, 238, ${p.alpha})`;
        ctx.fill();
      }

      // 7. Bright Electric-Blue Central Energy Sphere
      ctx.save();
      ctx.beginPath();
      const spherePoints = size === 'compact' ? 40 : 84;
      for (let i = 0; i <= spherePoints; i++) {
        const angle = (i / spherePoints) * Math.PI * 2;
        const deform =
          currentState === 'responding'
            ? Math.sin(angle * 4 + phase * 3.2) * (1.2 + smoothedLevel * 4.2)
            : currentState === 'listening'
              ? Math.sin(angle * 3 + phase * 2.4) * (1.0 + smoothedLevel * 3.6)
              : currentState === 'thinking'
                ? Math.sin(angle * 6 - phase * 3.5) * 1.5
                : Math.sin(angle * 2 + phase) * 0.5;

        const r = coreRadius + (size === 'compact' ? deform * 0.25 : deform);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const lightX = cx - coreRadius * 0.28 + Math.cos(phase * 0.7) * (coreRadius * 0.08);
      const lightY = cy - coreRadius * 0.32 + Math.sin(phase * 0.7) * (coreRadius * 0.08);

      const sphereGrad = ctx.createRadialGradient(
        lightX,
        lightY,
        coreRadius * 0.05,
        cx,
        cy,
        coreRadius * 1.08
      );

      if (currentState === 'listening') {
        sphereGrad.addColorStop(0, '#FFFFFF');
        sphereGrad.addColorStop(0.2, '#BAE6FD');
        sphereGrad.addColorStop(0.5, '#22D3EE');
        sphereGrad.addColorStop(0.82, '#0284C7');
        sphereGrad.addColorStop(1, '#082F49');
      } else if (currentState === 'thinking') {
        sphereGrad.addColorStop(0, '#F0F9FF');
        sphereGrad.addColorStop(0.22, '#60A5FA');
        sphereGrad.addColorStop(0.54, '#2563EB');
        sphereGrad.addColorStop(0.85, '#1D4ED8');
        sphereGrad.addColorStop(1, '#0B1739');
      } else if (currentState === 'responding') {
        sphereGrad.addColorStop(0, '#FFFFFF');
        sphereGrad.addColorStop(0.22, '#E0F2FE');
        sphereGrad.addColorStop(0.5, '#38BDF8');
        sphereGrad.addColorStop(0.82, '#0284C7');
        sphereGrad.addColorStop(1, '#0C4A6E');
      } else {
        sphereGrad.addColorStop(0, '#F0F9FF');
        sphereGrad.addColorStop(0.24, '#67E8F9');
        sphereGrad.addColorStop(0.56, '#0EA5E9');
        sphereGrad.addColorStop(0.86, '#1D4ED8');
        sphereGrad.addColorStop(1, '#061836');
      }

      ctx.fillStyle = sphereGrad;
      ctx.fill();
      ctx.clip();

      // Internal aurora energy currents
      for (let k = 0; k < 2; k++) {
        const rx = cx + Math.cos(phase * (1.05 + k * 0.45) + k * 2.1) * coreRadius * 0.36;
        const ry = cy + Math.sin(phase * (0.85 + k * 0.35) + k * 2.1) * coreRadius * 0.36;
        const ribbonGrad = ctx.createRadialGradient(rx, ry, 1, cx, cy, coreRadius * 0.94);
        ribbonGrad.addColorStop(
          0,
          k === 0 ? 'rgba(224, 242, 254, 0.62)' : 'rgba(56, 189, 248, 0.48)'
        );
        ribbonGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
        ctx.fillStyle = ribbonGrad;
        ctx.fillRect(
          cx - coreRadius - 8,
          cy - coreRadius - 8,
          coreRadius * 2 + 16,
          coreRadius * 2 + 16
        );
      }

      // Subtle internal holographic latitude/meridian wireframe ellipses
      if (size !== 'compact') {
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.16)';
        ctx.lineWidth = 0.85;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          coreRadius * 0.92,
          Math.max(4, coreRadius * (0.28 + Math.sin(phase * 0.7) * 0.1)),
          phase * 0.25,
          0,
          Math.PI * 2
        );
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          Math.max(4, coreRadius * (0.34 + Math.cos(phase * 0.6) * 0.12)),
          coreRadius * 0.92,
          -phase * 0.2,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }

      // Inner bright white-blue energy nucleus
      const nucleusRadius =
        coreRadius *
        (currentState === 'responding'
          ? 0.3 + smoothedLevel * 0.12
          : currentState === 'thinking'
            ? 0.32 + Math.sin(phase * 3) * 0.04
            : 0.25);
      const nucleusGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusRadius * 2.1);
      nucleusGrad.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
      nucleusGrad.addColorStop(0.38, 'rgba(186, 230, 253, 0.74)');
      nucleusGrad.addColorStop(0.75, 'rgba(34, 211, 238, 0.26)');
      nucleusGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
      ctx.fillStyle = nucleusGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusRadius * 2.1, 0, Math.PI * 2);
      ctx.fill();

      // Holographic scan beam passing across sphere
      if (size !== 'compact' && !reducedMotion) {
        const scanProgress = ((phase * 0.32) % 2) - 1;
        const scanY = cy + scanProgress * coreRadius;
        const scanGrad = ctx.createLinearGradient(cx, scanY - 9, cx, scanY + 9);
        scanGrad.addColorStop(0, 'rgba(186, 230, 253, 0)');
        scanGrad.addColorStop(0.5, 'rgba(224, 242, 254, 0.38)');
        scanGrad.addColorStop(1, 'rgba(186, 230, 253, 0)');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(cx - coreRadius, scanY - 9, coreRadius * 2, 18);
      }

      ctx.restore();

      // Luminous sphere outer rim
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx.strokeStyle =
        currentState === 'listening' || currentState === 'responding'
          ? 'rgba(224, 242, 254, 0.72)'
          : 'rgba(125, 211, 252, 0.48)';
      ctx.lineWidth = size === 'compact' ? 0.9 : 1.4;
      ctx.stroke();

      rafId = window.requestAnimationFrame(drawFrame);
    };

    rafId = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      ro?.disconnect();
    };
  }, [audioLevelRef, size]);

  const isInteractive = Boolean(onClick);
  const ringSpeedOuter = state === 'thinking' ? 'chormo-ring-fast-cw' : 'chormo-ring-cw';
  const ringSpeedInner = state === 'thinking' ? 'chormo-ring-fast-ccw' : 'chormo-ring-ccw';
  const ringSpeedMid = state === 'thinking' ? 'chormo-ring-fast-cw' : 'chormo-ring-mid-ccw';

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
      aria-label={ariaLabel || 'CHORMO AI Holographic Core'}
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
      {/* Layer 1: Precision outer calibrated JARVIS telemetry ring */}
      <svg
        viewBox="0 0 360 360"
        fill="none"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 w-full h-full transition-opacity duration-300 ${ringSpeedOuter} ${
          state === 'listening' || state === 'responding'
            ? 'opacity-95'
            : 'opacity-75 group-hover:opacity-95'
        }`}
      >
        <circle
          cx="180"
          cy="180"
          r="171"
          stroke="rgba(56, 189, 248, 0.2)"
          strokeWidth="1"
          strokeDasharray="2 7.4"
        />
        <circle
          cx="180"
          cy="180"
          r="160"
          stroke="rgba(34, 211, 238, 0.28)"
          strokeWidth="1.25"
          strokeDasharray="48 22 10 22"
        />
        {/* Cardinal HUD reticle brackets */}
        <path
          d="M180 6V20M180 340V354M6 180H20M340 180H354"
          stroke="rgba(186, 230, 253, 0.6)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M66 44A154 154 0 0 1 112 24M248 24A154 154 0 0 1 294 44M294 316A154 154 0 0 1 248 336M112 336A154 154 0 0 1 66 316"
          stroke="rgba(59, 130, 246, 0.55)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {/* Layer 2: Counter-rotating mid holographic segmented circuit ring */}
      <svg
        viewBox="0 0 360 360"
        fill="none"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 w-full h-full transition-opacity duration-300 ${ringSpeedMid} ${
          state === 'thinking' ? 'opacity-95' : 'opacity-70 group-hover:opacity-90'
        }`}
      >
        <circle
          cx="180"
          cy="180"
          r="142"
          stroke="rgba(125, 211, 252, 0.26)"
          strokeWidth="1"
          strokeDasharray="24 14 5 14"
        />
        <circle
          cx="180"
          cy="180"
          r="128"
          stroke="rgba(34, 211, 238, 0.24)"
          strokeWidth="1.4"
          strokeDasharray="64 46"
        />
        <circle cx="180" cy="38" r="2.6" fill="#BAE6FD" opacity="0.85" />
        <circle cx="180" cy="322" r="2.6" fill="#22D3EE" opacity="0.85" />
        <circle cx="38" cy="180" r="2.2" fill="#60A5FA" opacity="0.8" />
        <circle cx="322" cy="180" r="2.2" fill="#60A5FA" opacity="0.8" />
      </svg>

      {/* Layer 3: Inner inclined gyroscopic holographic rings */}
      <svg
        viewBox="0 0 360 360"
        fill="none"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 w-full h-full transition-opacity duration-300 ${ringSpeedInner} ${
          state === 'idle' ? 'opacity-55 group-hover:opacity-85' : 'opacity-85'
        }`}
      >
        <ellipse
          cx="180"
          cy="180"
          rx="116"
          ry="84"
          transform="rotate(-24 180 180)"
          stroke="rgba(56, 189, 248, 0.24)"
          strokeWidth="1"
          strokeDasharray="16 12"
        />
        <ellipse
          cx="180"
          cy="180"
          rx="116"
          ry="84"
          transform="rotate(36 180 180)"
          stroke="rgba(186, 230, 253, 0.2)"
          strokeWidth="0.9"
          strokeDasharray="8 14"
        />
      </svg>

      <canvas ref={canvasRef} className="relative z-10 w-full h-full block" />
    </div>
  );
}
