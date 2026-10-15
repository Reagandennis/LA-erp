'use client';

import { type RefObject, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Zero-dependency SVG charts for the reports module.
 *
 * Every chart follows the same contract: thin marks, hairline grid, a legend
 * whenever there is more than one series, a hover/focus tooltip that lists
 * every series at the pointer, and a table twin supplied by the card that
 * hosts it (see `ChartCard` in reports-client.tsx). Values are therefore never
 * reachable only through hover or only through colour.
 *
 * Colours are not hand-picked: the categorical slots below were validated with
 * the data-viz palette checker (lightness band, chroma floor, colour-blind
 * separation, normal-vision floor) against the white card surface. Amber and
 * aqua sit under 3:1 contrast on white, which is why direct labels and the
 * table view are mandatory rather than optional here.
 */
export const viz = {
  /** Categorical slots, fixed order — assign in sequence, never cycle. */
  series: ['#1c5cab', '#eda100', '#1baf7a', '#6250d6', '#e34948'] as const,
  /** Reserved state colours; always paired with a label, never a series colour. */
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const,
  /** Ordered workflow stages (draft → sent → active): one hue, light → dark. */
  stage: ['#86b6ef', '#3987e5', '#1c5cab'] as const,
  /** Five-step severity ramp (aging buckets), one hue, light → dark. */
  ordinal5: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'] as const,
  /** De-emphasis for "other" / idle / open. */
  neutral: '#a3a39c',
  ink: { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781' },
  grid: '#e7e6e1',
  baseline: '#c3c2b7',
  surface: '#ffffff',
} as const;

export const BRAND_BLUE = viz.series[0];
export const BRAND_YELLOW = viz.series[1];

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** Axis and label text, in real pixels (charts draw 1 viewBox unit = 1px). */
const TEXT = 11;
/** Rough advance of one TEXT-sized character, for collision checks. */
const CHAR_W = 6.4;

// ---------------------------------------------------------------------------
// Scale helpers
// ---------------------------------------------------------------------------

/**
 * Axis top for the four-step grid every chart draws (0, ¼, ½, ¾, top): four
 * times a round step (1, 2, 2.5 or 5 × 10ⁿ), so each gridline is a round
 * number too — 26 tops out at 40 (10, 20, 30), not 50 (12.5, 25, 37.5).
 * Steps never go below 1 for whole-number data, so a count of 1 reads 1–4
 * rather than 0.25, 0.5, 0.75.
 */
export function niceTop(max: number, integer = false): number {
  if (max <= 0) return integer ? 4 : 1;
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const scaled = raw / pow;
  let step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * pow;
  // 2.5 × 10⁰ would put a gridline at 2.5 on whole-number data.
  if (integer) step = step < 1 ? 1 : step === 2.5 ? 5 : step;
  return step * 4;
}

/** 1,234 → 1.2K; axis ticks compact from a thousand up. */
export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${Math.round(value)}`;
}

export interface Series {
  name: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface TooltipRow {
  label: string;
  value: string;
  color: string;
  /** `line` keys a line series, `rect` a bar/segment. */
  key?: 'line' | 'rect';
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: TooltipRow[];
}

/**
 * Pointer-anchored readout. Positioned inside the chart's relative wrapper,
 * flipped left of the pointer when it would overflow the right edge.
 */
function Tooltip({ state, width }: { state: TooltipState | null; width: number }) {
  if (!state) return null;
  const flip = state.x > width * 0.62;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-[9rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{
        left: flip ? undefined : state.x + 14,
        right: flip ? width - state.x + 14 : undefined,
        top: Math.max(0, state.y - 12),
      }}
    >
      <p className="mb-1 font-medium" style={{ color: viz.ink.secondary }}>
        {state.title}
      </p>
      <ul className="space-y-0.5">
        {state.rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5" style={{ color: viz.ink.secondary }}>
              {r.key === 'rect' ? (
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: r.color }} />
              ) : (
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: r.color }} />
              )}
              {r.label}
            </span>
            <span className="font-semibold tabular-nums" style={{ color: viz.ink.primary }}>
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shared pointer → wrapper-pixel plumbing for every chart with a tooltip. */
function useTooltip() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [width, setWidth] = useState(0);

  const show = useCallback((clientX: number, clientY: number, title: string, rows: TooltipRow[]) => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setWidth(rect.width);
    setTip({ x: clientX - rect.left, y: clientY - rect.top, title, rows });
  }, []);

  /** Anchor at a point in SVG viewBox units (keyboard focus has no pointer). */
  const showAt = useCallback(
    (svg: SVGSVGElement | null, vx: number, vy: number, vw: number, vh: number, title: string, rows: TooltipRow[]) => {
      const el = wrapperRef.current;
      if (!el || !svg) return;
      const wrap = el.getBoundingClientRect();
      const box = svg.getBoundingClientRect();
      setWidth(wrap.width);
      setTip({
        x: box.left - wrap.left + (vx / vw) * box.width,
        y: box.top - wrap.top + (vy / vh) * box.height,
        title,
        rows,
      });
    },
    [],
  );

  const hide = useCallback(() => setTip(null), []);
  return { wrapperRef, tip, width, show, showAt, hide };
}

/**
 * Rendered width of a chart's wrapper. Charts draw at this width so text stays
 * 11px on a wide card instead of scaling up with a fixed viewBox; `initial`
 * covers the server render until the first measurement.
 */
function useChartWidth(ref: RefObject<HTMLDivElement | null>, initial = 640) {
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Left margin that fits the widest y-axis label ("KES 12.5M" needs more than "$100K"). */
function axisWidth(labels: string[]): number {
  return Math.max(40, ...labels.map((l) => Math.ceil(l.length * CHAR_W) + 12));
}

/** Show every nth category label, counting back from the latest so it always shows. */
function labelStride(slot: number, labelWidth = 52): number {
  return slot > 0 ? Math.max(1, Math.ceil(labelWidth / slot)) : 1;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export function Legend({ items, shape = 'rect' }: { items: Series[]; shape?: 'rect' | 'line' }) {
  if (items.length < 2) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5 text-xs" style={{ color: viz.ink.secondary }}>
          {shape === 'line' ? (
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: i.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          )}
          {i.name}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column chart (grouped)
// ---------------------------------------------------------------------------

/** A column with a 4px rounded cap and a square base on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, baseline: number): string {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return '';
  return [
    `M ${x} ${baseline}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${baseline}`,
    'Z',
  ].join(' ');
}

/**
 * Grouped columns. Hover or focus a month to read every series at once; the
 * latest group carries direct value labels where they fit, so the newest
 * figures are readable without a pointer.
 */
export function ColumnChart({
  data,
  series,
  height = 240,
  formatValue = compactNumber,
  formatTick = compactNumber,
}: {
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
  formatValue?: (value: number) => string;
  formatTick?: (value: number) => string;
}) {
  const { wrapperRef, tip, width: wrapW, show, showAt, hide } = useTooltip();
  const width = useChartWidth(wrapperRef);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const values = data.flatMap((d) => d.values);
  const max = niceTop(Math.max(1, ...values), values.every(Number.isInteger));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const padL = axisWidth(ticks.map((t) => formatTick(max * t)));
  const padR = 8;
  const padTop = 22;
  const padBottom = 28;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = height - padTop - padBottom;
  const baseline = padTop + plotH;

  const bandW = plotW / Math.max(1, data.length);
  const gap = 2;
  // Thin marks: cap the column at 24px and let the band's remainder be air.
  const barW = Math.min(24, Math.max(3, (bandW * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const stride = labelStride(bandW);

  const barX = (gi: number, si: number) => padL + bandW * gi + (bandW - groupW) / 2 + si * (barW + gap);
  const barTop = (v: number) => baseline - (v / max) * plotH;

  // Direct labels on the latest group, placed tallest-first. A label is
  // dropped rather than nudged when it would hit another label or sit on a
  // taller neighbouring column; the tooltip and table still carry the value.
  const lastIndex = data.length - 1;
  const directLabels: { si: number; text: string; cx: number; y: number; w: number }[] = [];
  const lastValues = data[lastIndex]?.values ?? [];
  for (const { v, si } of lastValues.map((v, si) => ({ v, si })).filter((c) => c.v > 0).sort((a, b) => b.v - a.v)) {
    const text = formatValue(v);
    const w = text.length * CHAR_W;
    const cx = barX(lastIndex, si) + barW / 2;
    const y = barTop(v) - 6;
    const hitsLabel = directLabels.some((p) => Math.abs(p.cx - cx) < (p.w + w) / 2 + 2 && Math.abs(p.y - y) < TEXT + 2);
    const hitsColumn = lastValues.some((o, oi) => {
      if (oi === si || o <= v) return false;
      const ox = barX(lastIndex, oi);
      return cx + w / 2 > ox && cx - w / 2 < ox + barW && y > barTop(o);
    });
    if (!hitsLabel && !hitsColumn) directLabels.push({ si, text, cx, y, w });
  }

  const rowsFor = (gi: number): TooltipRow[] =>
    series.map((s, si) => ({ label: s.name, value: formatValue(data[gi]!.values[si] ?? 0), color: s.color, key: 'rect' }));

  return (
    <div ref={wrapperRef} className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" style={{ fontFamily: FONT }}>
        {ticks.map((t) => {
          const y = padTop + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke={t === 0 ? viz.baseline : viz.grid} strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={TEXT} fill={viz.ink.muted}>
                {formatTick(max * t)}
              </text>
            </g>
          );
        })}

        {data.map((group, gi) => {
          const bx = padL + bandW * gi;
          const dim = hovered !== null && hovered !== gi;
          return (
            <g key={group.label} opacity={dim ? 0.55 : 1} style={{ transition: 'opacity 120ms' }}>
              {group.values.map((value, si) => (
                <path
                  key={si}
                  d={columnPath(barX(gi, si), barTop(value), barW, baseline - barTop(value), baseline)}
                  fill={series[si]?.color ?? viz.neutral}
                />
              ))}
              {(lastIndex - gi) % stride === 0 && (
                <text x={bx + bandW / 2} y={height - 8} textAnchor="middle" fontSize={TEXT} fill={viz.ink.muted}>
                  {group.label}
                </text>
              )}
              {/* The whole band is the hit target, not just the painted pixels. */}
              <rect
                x={bx}
                y={padTop}
                width={bandW}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${group.label}: ${rowsFor(gi).map((r) => `${r.label} ${r.value}`).join(', ')}`}
                className="outline-none"
                onPointerMove={(e) => {
                  setHovered(gi);
                  show(e.clientX, e.clientY, group.label, rowsFor(gi));
                }}
                onPointerLeave={() => {
                  setHovered(null);
                  hide();
                }}
                onFocus={() => {
                  setHovered(gi);
                  showAt(svgRef.current, bx + bandW / 2, padTop, width, height, group.label, rowsFor(gi));
                }}
                onBlur={() => {
                  setHovered(null);
                  hide();
                }}
              />
            </g>
          );
        })}

        {directLabels.map((l) => (
          <text
            key={l.si}
            x={l.cx}
            y={l.y}
            textAnchor="middle"
            fontSize={TEXT}
            fontWeight={600}
            fill={viz.ink.secondary}
            pointerEvents="none"
            opacity={hovered !== null && hovered !== lastIndex ? 0.55 : 1}
          >
            {l.text}
          </text>
        ))}
      </svg>
      <Tooltip state={tip} width={wrapW} />
      <Legend items={series} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend chart (one or more lines)
// ---------------------------------------------------------------------------

/**
 * Lines over time. A crosshair snaps to the nearest month and the tooltip
 * lists every series there. A single series gets a soft area wash and no
 * legend (the title names it); up to four get end labels when they don't
 * collide, otherwise the legend and tooltip carry identity.
 */
export function TrendChart({
  data,
  series,
  height = 240,
  formatValue = compactNumber,
  formatTick = compactNumber,
}: {
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
  formatValue?: (value: number) => string;
  formatTick?: (value: number) => string;
}) {
  const { wrapperRef, tip, width: wrapW, show, showAt, hide } = useTooltip();
  const width = useChartWidth(wrapperRef);
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();

  const values = data.flatMap((d) => d.values);
  const max = niceTop(Math.max(1, ...values), values.every(Number.isInteger));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const padL = axisWidth(ticks.map((t) => formatTick(max * t)));
  // Room on the right for end labels (multi-series) or the last value (single).
  const padR = series.length > 1 ? Math.max(28, ...series.map((s) => s.name.length * CHAR_W + 14)) : 28;
  const padTop = 18;
  const padBottom = 28;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = height - padTop - padBottom;
  const baseline = padTop + plotH;

  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xOf = (i: number) => padL + stepX * i;
  const yOf = (v: number) => padTop + plotH * (1 - v / max);
  const stride = labelStride(stepX || plotW);
  const lastIndex = data.length - 1;

  const paths = series.map((s, si) => {
    const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.values[si] ?? 0) }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const area = pts.length
      ? `${line} L ${pts[pts.length - 1]!.x} ${baseline} L ${pts[0]!.x} ${baseline} Z`
      : '';
    return { ...s, pts, line, area };
  });

  // End labels only when they separate at the right edge; otherwise skip
  // rather than nudge them off their lines.
  const endYs = paths.map((p) => p.pts[p.pts.length - 1]?.y ?? 0);
  const endLabelsFit =
    series.length > 1 &&
    series.length <= 4 &&
    endYs.every((y, i) => endYs.every((o, j) => i === j || Math.abs(y - o) >= TEXT + 2));

  const rowsFor = (i: number): TooltipRow[] =>
    series.map((s, si) => ({ label: s.name, value: formatValue(data[i]!.values[si] ?? 0), color: s.color, key: 'line' }));

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return 0;
    const box = svg.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * width;
    return Math.max(0, Math.min(data.length - 1, Math.round((vx - padL) / (stepX || 1))));
  };

  return (
    <div ref={wrapperRef} className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" style={{ fontFamily: FONT }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color ?? viz.series[0]} stopOpacity={0.12} />
            <stop offset="100%" stopColor={series[0]?.color ?? viz.series[0]} stopOpacity={0} />
          </linearGradient>
        </defs>

        {ticks.map((t) => {
          const y = padTop + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke={t === 0 ? viz.baseline : viz.grid} strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={TEXT} fill={viz.ink.muted}>
                {formatTick(max * t)}
              </text>
            </g>
          );
        })}

        {series.length === 1 && paths[0] && data.length > 1 && <path d={paths[0].area} fill={`url(#${gradientId})`} />}

        {active !== null && (
          <line x1={xOf(active)} y1={padTop} x2={xOf(active)} y2={baseline} stroke={viz.baseline} strokeWidth={1} />
        )}

        {paths.map((p) => (
          <g key={p.name}>
            <path d={p.line} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* Markers only where the eye is: the latest point and the hovered month. */}
            {p.pts.map((pt, i) =>
              active === i || i === lastIndex ? (
                <circle key={i} cx={pt.x} cy={pt.y} r={4.5} fill={p.color} stroke={viz.surface} strokeWidth={2} />
              ) : null,
            )}
            {endLabelsFit && p.pts.length > 0 && (
              <text
                x={p.pts[p.pts.length - 1]!.x + 9}
                y={p.pts[p.pts.length - 1]!.y + 4}
                fontSize={TEXT}
                fontWeight={600}
                fill={viz.ink.secondary}
              >
                {p.name}
              </text>
            )}
          </g>
        ))}

        {series.length === 1 && paths[0] && paths[0].pts.length > 0 && (
          <text
            x={paths[0].pts[paths[0].pts.length - 1]!.x}
            y={paths[0].pts[paths[0].pts.length - 1]!.y - 10}
            textAnchor="end"
            fontSize={TEXT}
            fontWeight={600}
            fill={viz.ink.secondary}
          >
            {formatValue(data[data.length - 1]!.values[0] ?? 0)}
          </text>
        )}

        {data.map((d, i) =>
          (lastIndex - i) % stride === 0 ? (
            <text key={d.label} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize={TEXT} fill={viz.ink.muted}>
              {d.label}
            </text>
          ) : null,
        )}

        {/* One hit layer for the whole plot: the crosshair finds the X. */}
        <rect
          x={padL - stepX / 2}
          y={padTop}
          width={plotW + stepX}
          height={plotH}
          fill="transparent"
          onPointerMove={(e) => {
            const i = pick(e.clientX);
            setActive(i);
            show(e.clientX, e.clientY, data[i]!.label, rowsFor(i));
          }}
          onPointerLeave={() => {
            setActive(null);
            hide();
          }}
        />
        {data.map((d, i) => (
          <rect
            key={`k-${d.label}`}
            x={xOf(i) - 12}
            y={padTop}
            width={24}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            className="outline-none"
            aria-label={`${d.label}: ${rowsFor(i).map((r) => `${r.label} ${r.value}`).join(', ')}`}
            onFocus={() => {
              setActive(i);
              showAt(svgRef.current, xOf(i), yOf(d.values[0] ?? 0), width, height, d.label, rowsFor(i));
            }}
            onBlur={() => {
              setActive(null);
              hide();
            }}
          />
        ))}
      </svg>
      <Tooltip state={tip} width={wrapW} />
      <Legend items={series} shape="line" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/**
 * Drop empty slices and, past `max`, fold the smallest into "Other". Survivors
 * keep the order they came in (a lifecycle reads better than a ranking).
 */
export function foldSlices(slices: Slice[], max = 6): Slice[] {
  const present = slices.filter((s) => s.value > 0);
  if (present.length <= max) return present;
  const keep = new Set([...present].sort((a, b) => b.value - a.value).slice(0, max - 1));
  const rest = present.filter((s) => !keep.has(s)).reduce((acc, s) => acc + s.value, 0);
  return [...present.filter((s) => keep.has(s)), { label: 'Other', value: rest, color: viz.neutral }];
}

/** Swatch · label … share · value; the legend that carries every figure. */
function ValueLegend({
  items,
  total,
  active,
  onActive,
  formatValue,
}: {
  items: Slice[];
  total: number;
  active: number | null;
  onActive: (i: number | null) => void;
  formatValue: (value: number) => string;
}) {
  return (
    <ul className="w-full space-y-1">
      {items.map((d, i) => (
        <li
          key={d.label}
          className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-sm"
          style={{ background: active === i ? '#f4f4f2' : 'transparent' }}
          onPointerEnter={() => onActive(i)}
          onPointerLeave={() => onActive(null)}
        >
          <span className="flex min-w-0 items-center gap-2" style={{ color: viz.ink.secondary }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
            <span className="truncate">{d.label}</span>
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="w-9 text-right text-xs tabular-nums" style={{ color: viz.ink.muted }}>
              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : ''}
            </span>
            <span className="font-semibold tabular-nums" style={{ color: viz.ink.primary }}>
              {formatValue(d.value)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Part-to-whole at a glance, ≤ 6 segments, 2px surface gaps between them.
 * The legend carries value and share so nothing rests on hue alone.
 */
export function DonutChart({
  data,
  centerLabel,
  centerValue,
  formatValue = (v) => v.toLocaleString(),
}: {
  data: Slice[];
  centerLabel?: string;
  centerValue?: string;
  formatValue?: (value: number) => string;
}) {
  const slices = foldSlices(data);
  const total = slices.reduce((acc, d) => acc + d.value, 0);
  const size = 180;
  const radius = size / 2;
  const stroke = 22;
  const r = radius - stroke / 2 - 2;
  const circ = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  const [active, setActive] = useState<number | null>(null);
  const { wrapperRef, tip, width: wrapW, show, hide } = useTooltip();

  const arcs = slices.reduce<Array<Slice & { i: number; len: number; offset: number }>>((acc, d, i) => {
    const len = total > 0 ? (d.value / total) * circ : 0;
    const offset = acc.length ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.len + gap : 0;
    acc.push({ ...d, i, len: Math.max(0, len - gap), offset });
    return acc;
  }, []);

  return (
    <div ref={wrapperRef} className="relative flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-40 w-40 shrink-0" role="img" style={{ fontFamily: FONT }}>
        <g transform={`rotate(-90 ${radius} ${radius})`}>
          <circle cx={radius} cy={radius} r={r} fill="none" stroke={viz.grid} strokeWidth={stroke} />
          {arcs.map((a) =>
            a.len > 0 ? (
              <circle
                key={a.label}
                cx={radius}
                cy={radius}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={active === a.i ? stroke + 4 : stroke}
                strokeDasharray={`${a.len} ${circ - a.len}`}
                strokeDashoffset={-(a.offset + gap / 2)}
                opacity={active === null || active === a.i ? 1 : 0.35}
                style={{ transition: 'opacity 120ms, stroke-width 120ms', cursor: 'default' }}
                onPointerMove={(e) => {
                  setActive(a.i);
                  show(e.clientX, e.clientY, a.label, [
                    { label: 'Share', value: `${Math.round((a.value / total) * 100)}%`, color: a.color, key: 'rect' },
                    { label: 'Count', value: formatValue(a.value), color: a.color, key: 'rect' },
                  ]);
                }}
                onPointerLeave={() => {
                  setActive(null);
                  hide();
                }}
              />
            ) : null,
          )}
        </g>
        <text x={radius} y={radius - 2} textAnchor="middle" fontSize={24} fontWeight={600} fill={viz.ink.primary}>
          {centerValue ?? formatValue(total)}
        </text>
        {centerLabel && (
          <text x={radius} y={radius + 16} textAnchor="middle" fontSize={10} fill={viz.ink.muted}>
            {centerLabel}
          </text>
        )}
      </svg>
      {slices.length === 0 ? (
        <p className="w-full text-sm text-gray-400">Nothing to show yet.</p>
      ) : (
        <div className="w-full sm:max-w-sm">
          <ValueLegend items={slices} total={total} active={active} onActive={setActive} formatValue={formatValue} />
        </div>
      )}
      <Tooltip state={tip} width={wrapW} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked meter
// ---------------------------------------------------------------------------

/**
 * A single horizontal stack — aging composition, win/loss, busy/idle. 2px
 * surface gaps separate segments; each segment is its own hover target and
 * the figures underneath keep every value visible without hovering: a
 * compact inline row, or a full list with shares when the card has room.
 */
export function StackedMeter({
  segments,
  formatValue = (v) => v.toLocaleString(),
  legend = 'inline',
}: {
  segments: Slice[];
  formatValue?: (value: number) => string;
  legend?: 'inline' | 'list';
}) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const [active, setActive] = useState<number | null>(null);
  const { wrapperRef, tip, width: wrapW, show, hide } = useTooltip();

  return (
    <div ref={wrapperRef} className="relative space-y-3">
      <div className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full" style={{ background: total > 0 ? 'transparent' : viz.grid }}>
        {total > 0 &&
          segments.map((s, i) =>
            s.value > 0 ? (
              <div
                key={s.label}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(s.value / total) * 100}%`,
                  backgroundColor: s.color,
                  opacity: active === null || active === i ? 1 : 0.4,
                  transition: 'opacity 120ms',
                }}
                tabIndex={0}
                aria-label={`${s.label}: ${formatValue(s.value)}`}
                onPointerMove={(e) => {
                  setActive(i);
                  show(e.clientX, e.clientY, s.label, [
                    { label: 'Share', value: `${Math.round((s.value / total) * 100)}%`, color: s.color, key: 'rect' },
                    { label: 'Value', value: formatValue(s.value), color: s.color, key: 'rect' },
                  ]);
                }}
                onPointerLeave={() => {
                  setActive(null);
                  hide();
                }}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setActive(i);
                  show(r.left + r.width / 2, r.top, s.label, [
                    { label: 'Value', value: formatValue(s.value), color: s.color, key: 'rect' },
                  ]);
                }}
                onBlur={() => {
                  setActive(null);
                  hide();
                }}
              />
            ) : null,
          )}
      </div>
      {legend === 'list' ? (
        <ValueLegend items={segments} total={total} active={active} onActive={setActive} formatValue={formatValue} />
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {segments.map((s, i) => (
            <span
              key={s.label}
              className="flex items-center gap-1.5 rounded-md px-1 text-xs"
              style={{ background: active === i ? '#f4f4f2' : 'transparent' }}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            >
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
              <span style={{ color: viz.ink.secondary }}>{s.label}</span>
              <span className="font-semibold tabular-nums" style={{ color: viz.ink.primary }}>
                {formatValue(s.value)}
              </span>
            </span>
          ))}
        </div>
      )}
      <Tooltip state={tip} width={wrapW} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar list
// ---------------------------------------------------------------------------

/**
 * One thin bar per category on a shared scale, in the order given (a record
 * lifecycle, not a ranking). Used instead of a donut once there are more
 * categories than a ring can separate. Count and share sit beside each bar,
 * so hover only highlights the row; nothing is hidden behind it.
 */
export function BarList({
  data,
  formatValue = (v) => v.toLocaleString(),
}: {
  data: Slice[];
  formatValue?: (value: number) => string;
}) {
  const rows = data.filter((d) => d.value > 0);
  const total = rows.reduce((acc, d) => acc + d.value, 0);
  const max = Math.max(1, ...rows.map((d) => d.value));
  const [active, setActive] = useState<number | null>(null);

  if (rows.length === 0) return <p className="py-8 text-center text-sm text-gray-400">Nothing to show yet.</p>;

  return (
    <ul className="@container space-y-1">
      {rows.map((d, i) => (
        <li
          key={d.label}
          // A narrow card stacks the bar under its label so it keeps the full width.
          className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-1.5 py-1.5 text-sm @min-[30rem]:grid-cols-[minmax(5.5rem,8.5rem)_1fr_4.5rem]"
          style={{ background: active === i ? '#f4f4f2' : 'transparent' }}
          onPointerEnter={() => setActive(i)}
          onPointerLeave={() => setActive(null)}
        >
          <span className="truncate" style={{ color: viz.ink.secondary }}>
            {d.label}
          </span>
          <span className="order-last col-span-2 block h-2.5 @min-[30rem]:order-none @min-[30rem]:col-span-1">
            <span
              className="block h-full rounded-r"
              style={{ width: `max(3px, ${(d.value / max) * 100}%)`, backgroundColor: d.color }}
            />
          </span>
          <span className="flex items-baseline justify-end gap-2">
            <span className="text-xs tabular-nums" style={{ color: viz.ink.muted }}>
              {Math.round((d.value / total) * 100)}%
            </span>
            <span className="font-semibold tabular-nums" style={{ color: viz.ink.primary }}>
              {formatValue(d.value)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/** Twelve-point trend for a stat tile; the current period is marked with a dot. */
export function Sparkline({ values, color = viz.series[0] }: { values: number[]; color?: string }) {
  const width = 120;
  const height = 32;
  const pad = 4;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: pad + stepX * i, y: pad + (height - pad * 2) * (1 - (v - min) / range) }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" preserveAspectRatio="none" role="img" aria-hidden="true">
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      {last && <circle cx={last.x} cy={last.y} r={3} fill={color} stroke={viz.surface} strokeWidth={1.5} />}
    </svg>
  );
}
