import { useId } from 'react';

interface ChromoLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ChromoLogo({ size = 'md', className = '' }: ChromoLogoProps) {
  const uid = useId().replace(/:/g, '');
  const ringGrad = `chormo-ring-${uid}`;
  const coreGrad = `chormo-core-${uid}`;

  const dimensions =
    size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-14 h-14' : 'w-8 h-8';

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={`${dimensions} shrink-0 drop-shadow-[0_0_10px_rgba(34,211,238,0.35)] ${className}`}
    >
      <defs>
        <linearGradient id={ringGrad} x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#67E8F9" />
          <stop offset="50%" stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        <radialGradient id={coreGrad} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#E0F2FE" />
          <stop offset="45%" stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#0369A1" stopOpacity="0.85" />
        </radialGradient>
      </defs>

      {/* Outer translucent octo-ring housing */}
      <circle
        cx="20"
        cy="20"
        r="17.5"
        stroke="rgba(56, 189, 248, 0.25)"
        strokeWidth="1"
        fill="rgba(7, 17, 36, 0.72)"
      />

      {/* Precision segmented holographic arcs */}
      <circle
        cx="20"
        cy="20"
        r="14.5"
        stroke="rgba(34, 211, 238, 0.45)"
        strokeWidth="1.2"
        strokeDasharray="16 6 4 6"
      />

      {/* Geometric C aperture */}
      <path
        d="M26.5 13.6C24.8 11.7 22.5 10.6 19.8 10.6C14.7 10.6 10.6 14.8 10.6 20C10.6 25.2 14.7 29.4 19.8 29.4C22.6 29.4 25.1 28.1 26.8 26.1"
        stroke={`url(#${ringGrad})`}
        strokeWidth="2.8"
        strokeLinecap="round"
      />

      {/* Glowing core diamond */}
      <circle cx="20" cy="20" r="3.4" fill={`url(#${coreGrad})`} />
      <path
        d="M27.8 17.8L30 20L27.8 22.2L25.6 20L27.8 17.8Z"
        fill="#67E8F9"
      />
    </svg>
  );
}
