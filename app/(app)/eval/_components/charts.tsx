'use client';

import type { ReactNode } from 'react';
import type { EvalRunSummary } from '@/lib/types';
import type { EvalTranslationKeys } from '@/lib/i18n/translations';
import { metricsFromSummary, GOOD, GOLD, type RunMetrics } from './shared';

/* ───────────────────────── chart shell ───────────────────────── */

function ChartCard({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-[18px] flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-[14.5px] font-sans font-semibold">{title}</span>
        {legend}
      </div>
      {children}
    </div>
  );
}

function EmptyPlot({ text }: { text: string }) {
  return (
    <div className="flex-1 min-h-[180px] flex items-center justify-center">
      <p className="text-[12px] font-sans text-muted-foreground/60 italic text-center px-4">{text}</p>
    </div>
  );
}

/* ───────────────────────── trend chart ───────────────────────── */

const SERIES = [
  { key: 'faithfulness', color: GOOD, labelKey: 'faithfulness', get: (m: RunMetrics) => m.faithfulness },
  { key: 'recall', color: GOLD, labelKey: 'recallAtK', get: (m: RunMetrics) => m.recall },
] as const;

/** Two 0–1 series (faithfulness + context recall) plotted across runs, oldest → newest. */
export function TrendChart({
  history,
  evalT,
}: {
  history: EvalRunSummary[];
  evalT: EvalTranslationKeys;
}) {
  const chrono = [...history].reverse();
  const metrics = chrono.map(metricsFromSummary);
  const hasData = metrics.length >= 2 && SERIES.some(s => metrics.filter(m => s.get(m) != null).length >= 2);

  const legend = (
    <span className="flex items-center gap-3.5 text-[11.5px] font-sans text-muted-foreground">
      {SERIES.map(s => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-[9px] h-[3px] rounded-sm" style={{ background: s.color }} />
          {evalT[s.labelKey]}
        </span>
      ))}
    </span>
  );

  if (!hasData) {
    return (
      <ChartCard title={evalT.trendAcrossRuns} legend={legend}>
        <EmptyPlot text={evalT.chartNeedRuns} />
      </ChartCard>
    );
  }

  const W = 580;
  const H = 190;
  const n = metrics.length;
  const mapX = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const mapY = (v: number) => H - 6 - v * (H - 18);

  const step = Math.max(1, Math.ceil(n / 7));
  const ticks = chrono.map((_, i) => i).filter(i => i % step === 0 || i === n - 1);

  return (
    <ChartCard title={evalT.trendAcrossRuns} legend={legend}>
      <div className="flex-1 min-h-[190px]">
        <svg width="100%" height="190" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={evalT.trendAcrossRuns}>
          <defs>
            <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOOD} stopOpacity={0.22} />
              <stop offset="100%" stopColor={GOOD} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* gridlines */}
          {[0.25, 0.5, 0.75].map(g => (
            <line key={g} x1={0} y1={mapY(g)} x2={W} y2={mapY(g)} stroke="hsl(var(--border))" strokeWidth={1} />
          ))}

          {SERIES.map((s, si) => {
            const pts = metrics
              .map((m, i) => ({ i, v: s.get(m) }))
              .filter((p): p is { i: number; v: number } => p.v != null);
            if (pts.length < 2) return null;
            const line = pts.map(p => `${mapX(p.i).toFixed(1)},${mapY(p.v).toFixed(1)}`).join(' ');
            const last = pts[pts.length - 1];
            return (
              <g key={s.key}>
                {si === 0 && (
                  <polygon
                    points={`${mapX(pts[0].i).toFixed(1)},${H} ${line} ${mapX(last.i).toFixed(1)},${H}`}
                    fill="url(#trend-area)"
                  />
                )}
                <polyline points={line} fill="none" stroke={s.color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={mapX(last.i)} cy={mapY(last.v)} r={4} fill={s.color} stroke="hsl(var(--card))" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground mt-1.5">
          {ticks.map(i => (
            <span key={i}>{String(i + 1).padStart(2, '0')}</span>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

/* ───────────────────────── scatter chart ───────────────────────── */

/** One bubble per run: x = latency, y = quality (faithfulness ?? pass rate), r ∝ pass rate. */
export function ScatterChart({
  history,
  evalT,
}: {
  history: EvalRunSummary[];
  evalT: EvalTranslationKeys;
}) {
  const points = history
    .map(metricsFromSummary)
    .map(m => ({ x: m.avgLatencyMs, y: m.faithfulness ?? m.passRate, size: m.passRate ?? 0 }))
    .filter((p): p is { x: number; y: number; size: number } => p.y != null);

  if (points.length < 2) {
    return (
      <ChartCard title={evalT.scatterTitle} legend={<span className="text-[11.5px] font-sans text-muted-foreground">{evalT.scatterCaption}</span>}>
        <EmptyPlot text={evalT.chartNeedRuns} />
      </ChartCard>
    );
  }

  const W = 300;
  const H = 172;
  const PAD = 30;
  const plotW = W - PAD - 8;
  const plotH = H - PAD - 12;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const mapX = (x: number) => PAD + ((x - xMin) / xSpan) * plotW;
  const mapY = (y: number) => 12 + (1 - (y - yMin) / ySpan) * plotH;
  const bestIdx = ys.indexOf(yMax);

  return (
    <ChartCard title={evalT.scatterTitle} legend={<span className="text-[11.5px] font-sans text-muted-foreground">{evalT.scatterCaption}</span>}>
      <div className="flex-1 min-h-[172px]">
        <svg width="100%" height="172" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={evalT.scatterTitle}>
          <line x1={PAD} y1={H - PAD} x2={W - 8} y2={H - PAD} stroke="hsl(var(--border))" strokeWidth={1} />
          <line x1={PAD} y1={12} x2={PAD} y2={H - PAD} stroke="hsl(var(--border))" strokeWidth={1} />

          {points.map((p, i) => {
            const best = i === bestIdx;
            const r = 6 + p.size * 9;
            const color = best ? GOOD : i === bestIdx - 1 ? GOLD : 'hsl(var(--muted-foreground))';
            return (
              <g key={i}>
                <circle
                  cx={mapX(p.x)}
                  cy={mapY(p.y)}
                  r={r}
                  fill={`color-mix(in srgb, ${color} ${best ? 28 : 18}%, transparent)`}
                  stroke={color}
                  strokeWidth={best ? 2 : 1.6}
                />
                {best && (
                  <text x={mapX(p.x)} y={mapY(p.y) - r - 5} textAnchor="middle" className="fill-foreground" style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}>
                    {evalT.bestLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="font-mono text-[10px] text-muted-foreground text-center mt-0.5">{evalT.scatterAxisLatency}</div>
      </div>
    </ChartCard>
  );
}
