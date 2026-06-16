'use client';

// Zero-dependency, brand-colored SVG charts. Every component is responsive via a
// fixed viewBox + `h-auto w-full`, so it scales to its container.

export const BRAND_BLUE = '#03458f';
export const BRAND_YELLOW = '#f9b232';

// Soft palette reused for categorical series (status donuts, etc.).
export const CHART_PALETTE = ['#03458f', '#f9b232', '#0ea5e9', '#10b981', '#f43f5e', '#a855f7', '#94a3b8'];

function niceTop(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const scaled = max / pow;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * pow;
}

export interface Series {
  name: string;
  color: string;
}

/** Grouped vertical bar chart. */
export function BarChart({
  data,
  series,
  height = 200,
  formatValue,
}: {
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const width = 640;
  const padX = 40;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const max = niceTop(Math.max(1, ...data.flatMap((d) => d.values)));
  const groupW = plotW / Math.max(1, data.length);
  const barGap = 4;
  const barW = Math.max(2, (groupW - barGap * (series.length + 1)) / series.length);
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
        {gridLines.map((g) => {
          const y = padTop + plotH * (1 - g);
          return (
            <g key={g}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={padX - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
                {formatValue ? formatValue(max * g) : Math.round(max * g)}
              </text>
            </g>
          );
        })}
        {data.map((group, gi) => {
          const gx = padX + groupW * gi;
          return (
            <g key={group.label}>
              {group.values.map((value, si) => {
                const h = (value / max) * plotH;
                const x = gx + barGap * (si + 1) + barW * si;
                const y = padTop + plotH - h;
                return (
                  <rect key={si} x={x} y={y} width={barW} height={Math.max(0, h)} rx={2} fill={series[si].color}>
                    <title>{`${group.label} · ${series[si].name}: ${formatValue ? formatValue(value) : value}`}</title>
                  </rect>
                );
              })}
              <text x={gx + groupW / 2} y={height - 10} textAnchor="middle" fontSize={9} fill="#94a3b8">
                {group.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
    </div>
  );
}

/** Single-series line chart with a soft area fill. */
export function LineChart({
  data,
  color = BRAND_BLUE,
  height = 200,
  formatValue,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const width = 640;
  const padX = 40;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const max = niceTop(Math.max(1, ...data.map((d) => d.value)));
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: padX + stepX * i,
    y: padTop + plotH * (1 - d.value / max),
    ...d,
  }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${line} L ${points[points.length - 1]?.x ?? padX} ${padTop + plotH} L ${points[0]?.x ?? padX} ${padTop + plotH} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
      <defs>
        <linearGradient id={`area-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {gridLines.map((g) => {
        const y = padTop + plotH * (1 - g);
        return (
          <g key={g}>
            <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padX - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              {formatValue ? formatValue(max * g) : Math.round(max * g)}
            </text>
          </g>
        );
      })}
      {data.length > 0 && <path d={area} fill={`url(#area-${color.replace('#', '')})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={3} fill="#fff" stroke={color} strokeWidth={2}>
            <title>{`${p.label}: ${formatValue ? formatValue(p.value) : p.value}`}</title>
          </circle>
          <text x={p.x} y={height - 10} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Donut chart with a centered total and a legend. */
export function DonutChart({
  data,
  size = 180,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const radius = size / 2;
  const stroke = size * 0.16;
  const r = radius - stroke / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-40 w-40 shrink-0" role="img">
        <g transform={`rotate(-90 ${radius} ${radius})`}>
          <circle cx={radius} cy={radius} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          {total > 0 &&
            data.map((d) => {
              if (d.value <= 0) return null;
              const len = (d.value / total) * circ;
              const seg = (
                <circle
                  key={d.label}
                  cx={radius}
                  cy={radius}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${len} ${circ - len}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
              );
              offset += len;
              return seg;
            })}
        </g>
        {(centerValue || centerLabel) && (
          <>
            <text x={radius} y={radius - 2} textAnchor="middle" fontSize={22} fontWeight={700} fill="#0f172a">
              {centerValue ?? total}
            </text>
            {centerLabel && (
              <text x={radius} y={radius + 16} textAnchor="middle" fontSize={10} fill="#94a3b8">
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>
      <div className="w-full space-y-2">
        {data.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-gray-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              {d.label}
            </span>
            <span className="font-semibold text-gray-900">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal stacked meter — utilization, aging composition, win/loss. */
export function ProgressMeter({
  segments,
  formatValue,
}: {
  segments: { label: string; value: number; color: string }[];
  formatValue?: (value: number) => string;
}) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {total > 0 &&
          segments.map((s) =>
            s.value > 0 ? (
              <div
                key={s.label}
                style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
                title={`${s.label}: ${formatValue ? formatValue(s.value) : s.value}`}
              />
            ) : null,
          )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-gray-900">{formatValue ? formatValue(s.value) : s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tiny inline trend line for KPI cards. */
export function Sparkline({ values, color = BRAND_BLUE }: { values: number[]; color?: string }) {
  const width = 100;
  const height = 28;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${stepX * i} ${height - ((v - min) / range) * height}`);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-full" preserveAspectRatio="none" role="img">
      <path d={points.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
