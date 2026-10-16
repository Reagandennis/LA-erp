import type { ReactNode } from 'react';

import type { IconKind } from './weather-data';

/**
 * Weather illustrations as inline SVG, so they look the same on every platform
 * (emoji differ wildly between macOS, Windows and Android).
 *
 * Gradients, the clip and the shadow live in <WeatherDefs/>, rendered once per
 * page; every icon references them by id. Cloud gradients use user-space
 * coordinates so the overlapping puffs share one seamless fill.
 */
export function WeatherDefs({ theme }: { theme: 'dark' | 'light' }) {
  // On a light page the white cloud needs a slightly deeper base to stand out.
  const cloudBase = theme === 'light' ? '#AEB8C7' : '#C3CAD6';
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
      <defs>
        <radialGradient id="wx-sun" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFF4B8" />
          <stop offset="45%" stopColor="#FFD233" />
          <stop offset="100%" stopColor="#F59E0B" />
        </radialGradient>
        <linearGradient id="wx-cloud" x1="0" y1="14" x2="0" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="65%" stopColor="#E7EBF1" />
          <stop offset="100%" stopColor={cloudBase} />
        </linearGradient>
        <linearGradient id="wx-cloud-storm" x1="0" y1="14" x2="0" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E5E9F0" />
          <stop offset="60%" stopColor="#A3AEBF" />
          <stop offset="100%" stopColor="#6B7789" />
        </linearGradient>
        <linearGradient id="wx-drop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id="wx-bolt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
        <radialGradient id="wx-moon" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#E2E8F0" />
          <stop offset="100%" stopColor="#A5B1C2" />
        </radialGradient>
        <clipPath id="wx-horizon" clipPathUnits="userSpaceOnUse">
          <rect x="0" y="0" width="64" height="40" />
        </clipPath>
        <filter id="wx-shadow" x="-20%" y="-20%" width="140%" height="170%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="1.8" floodColor="#0F172A" floodOpacity="0.3" />
        </filter>
      </defs>
    </svg>
  );
}

const RAYS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 1.45} fill="#FDB813" opacity="0.16" />
      {RAYS.map((angle) => (
        <line
          key={angle}
          x1={cx + Math.cos(angle) * r * 1.4}
          y1={cy + Math.sin(angle) * r * 1.4}
          x2={cx + Math.cos(angle) * r * 1.85}
          y2={cy + Math.sin(angle) * r * 1.85}
          stroke="#FDB813"
          strokeWidth={r * 0.22}
          strokeLinecap="round"
        />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="url(#wx-sun)" />
    </g>
  );
}

function Moon({ transform }: { transform: string }) {
  return (
    <path
      transform={transform}
      fill="url(#wx-moon)"
      d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
    />
  );
}

function Cloud({ transform, storm = false }: { transform?: string; storm?: boolean }) {
  return (
    <g transform={transform} fill={storm ? 'url(#wx-cloud-storm)' : 'url(#wx-cloud)'} filter="url(#wx-shadow)">
      <circle cx="22" cy="34" r="10" />
      <circle cx="34" cy="27" r="13" />
      <circle cx="46" cy="35" r="9" />
      <rect x="12" y="33" width="43" height="13" rx="6.5" />
    </g>
  );
}

const DROP_PATH = 'M0 -5C2.6 -1.6 3.2 0.2 3.2 1.6A3.2 3.2 0 0 1 -3.2 1.6C-3.2 0.2 -2.6 -1.6 0 -5Z';

function Drops({ points, scale = 1 }: { points: Array<[number, number]>; scale?: number }) {
  return (
    <g fill="url(#wx-drop)">
      {points.map(([x, y]) => (
        <path key={`${x}-${y}`} d={DROP_PATH} transform={`translate(${x} ${y}) rotate(18) scale(${scale})`} />
      ))}
    </g>
  );
}

export function WeatherIcon({
  kind,
  isDay = true,
  className,
}: {
  kind: IconKind;
  isDay?: boolean;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      {kind === 'clear' &&
        (isDay ? (
          <Sun cx={32} cy={32} r={12} />
        ) : (
          <g>
            <Moon transform="translate(3.2 3.2) scale(2.4)" />
            <circle cx="48" cy="14" r="1.6" fill="#E2E8F0" />
            <circle cx="54" cy="24" r="1.1" fill="#E2E8F0" />
          </g>
        ))}
      {kind === 'partly' && (
        <>
          {isDay ? <Sun cx={42} cy={22} r={10} /> : <Moon transform="translate(26 2) scale(1.55)" />}
          <Cloud transform="translate(-4 8) scale(0.92)" />
        </>
      )}
      {kind === 'cloudy' && (
        <>
          <Cloud transform="translate(10 -4) scale(0.72)" storm />
          <Cloud transform="translate(-2 6)" />
        </>
      )}
      {kind === 'fog' && (
        <>
          <Cloud transform="translate(0 -6)" />
          <g stroke="#B6C0CE" strokeWidth="3" strokeLinecap="round">
            <line x1="12" y1="48" x2="52" y2="48" />
            <line x1="16" y1="54" x2="46" y2="54" />
            <line x1="22" y1="60" x2="42" y2="60" />
          </g>
        </>
      )}
      {kind === 'drizzle' && (
        <>
          <Drops
            points={[
              [22, 51],
              [34, 53],
              [46, 51],
            ]}
            scale={0.75}
          />
          <Cloud transform="translate(0 -6)" />
        </>
      )}
      {kind === 'rain' && (
        <>
          <Drops
            points={[
              [19, 50],
              [31, 52],
              [43, 50],
              [25, 59],
              [37, 60],
            ]}
          />
          <Cloud transform="translate(0 -6)" />
        </>
      )}
      {kind === 'snow' && (
        <>
          <g fill="#FFFFFF" stroke="#BAE6FD" strokeWidth="1">
            {[
              [19, 50],
              [32, 53],
              [45, 50],
              [25, 59],
              [39, 60],
            ].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />
            ))}
          </g>
          <Cloud transform="translate(0 -6)" />
        </>
      )}
      {kind === 'thunder' && (
        <>
          <Drops
            points={[
              [17, 51],
              [47, 51],
            ]}
          />
          <polygon points="31,36 24,51 31,51 27,63 41,45 34,45 38,36" fill="url(#wx-bolt)" />
          <Cloud transform="translate(0 -8)" storm />
        </>
      )}
    </svg>
  );
}

/** A sun on the horizon with an arrow: up for sunrise, down for sunset. */
export function SunHorizonIcon({ direction, className }: { direction: 'up' | 'down'; className?: string }) {
  const fan = [-150, -120, -90, -60, -30].map((deg) => (deg * Math.PI) / 180);
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      {fan.map((angle) => (
        <line
          key={angle}
          x1={32 + Math.cos(angle) * 17}
          y1={40 + Math.sin(angle) * 17}
          x2={32 + Math.cos(angle) * 22}
          y2={40 + Math.sin(angle) * 22}
          stroke="#FDB813"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      ))}
      <circle cx="32" cy="40" r="13" fill="url(#wx-sun)" clipPath="url(#wx-horizon)" />
      <g stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {direction === 'up' ? (
          <>
            <path d="M32 38V30" />
            <path d="M28.5 33.5L32 30l3.5 3.5" />
          </>
        ) : (
          <>
            <path d="M32 29v8" />
            <path d="M28.5 33.5L32 37l3.5-3.5" />
          </>
        )}
      </g>
      <g stroke="#60A5FA" strokeWidth="2.6" strokeLinecap="round">
        <line x1="13" y1="45" x2="51" y2="45" />
        <line x1="19" y1="50.5" x2="45" y2="50.5" />
        <line x1="25" y1="56" x2="39" y2="56" />
      </g>
    </svg>
  );
}

// --- Line icons for labels and controls ------------------------------------------

type LineIconProps = { className?: string };

function LineIcon({ className, children }: LineIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PinIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </LineIcon>
);

export const SearchIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </LineIcon>
);

export const WindIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <path d="M3 8.5h10a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M3 12.5h15a3 3 0 1 1-3 3" />
    <path d="M3 16.5h6" />
  </LineIcon>
);

export const DropletIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <path d="M12 3.5c3.6 4.3 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.4-6.3 6-10.6z" />
  </LineIcon>
);

export const SunIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </LineIcon>
);

export const MoonIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
  </LineIcon>
);

export const EyeIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </LineIcon>
);

export const ChevronIcon = (p: LineIconProps) => (
  <LineIcon {...p}>
    <path d="M6 9l6 6 6-6" />
  </LineIcon>
);
