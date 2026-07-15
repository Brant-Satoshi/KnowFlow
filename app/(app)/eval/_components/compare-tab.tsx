'use client';

import { useState } from 'react';
import type { EvalRunSummary } from '@/lib/types';
import type { EvalTranslationKeys, Language } from '@/lib/i18n/translations';
import {
  METRIC_SPECS,
  metricsFromSummary,
  GOOD,
  GOLD,
  type RunMetrics,
  type MetricSpec,
} from './shared';
import { formatDateTime } from '@/lib/format';

const RUN_COLORS = [GOOD, GOLD, 'hsl(var(--muted-foreground))'];
const RUN_LETTERS = ['A', 'B', 'C'];
const MAX_RUNS = 3;

/** Curated metric rows (mirrors the design's compact compare view). */
const COMPARE_KEYS = ['faithfulness', 'answerRelevance', 'recall', 'precision', 'mrr', 'latency'];
const COMPARE_SPECS = COMPARE_KEYS.map(k => METRIC_SPECS.find(s => s.key === k)).filter((s): s is MetricSpec => !!s);

/** Bar width fraction (0–1) for a metric value, normalised per metric kind. */
function barFraction(spec: MetricSpec, value: number | null, rows: RunMetrics[]): number {
  if (value == null) return 0;
  if (spec.kind === 'latency') {
    const max = Math.max(...rows.map(m => spec.value(m) ?? 0), 1);
    return value / max;
  }
  return Math.max(0, Math.min(1, value));
}

/** Leading run + gap to the runner-up, formatted per metric kind. null = tie/insufficient. */
function lead(spec: MetricSpec, rows: RunMetrics[]): { idx: number; text: string } | null {
  const present = rows.map((m, i) => ({ v: spec.value(m), i })).filter((x): x is { v: number; i: number } => x.v != null);
  if (present.length < 2) return null;
  const sorted = [...present].sort((a, b) => (spec.higherIsBetter ? b.v - a.v : a.v - b.v));
  if (sorted[0].v === sorted[1].v) return null;
  const gap = Math.abs(sorted[0].v - sorted[1].v);
  const fmt =
    spec.kind === 'scalar'
      ? gap.toFixed(2).replace(/^0/, '')
      : spec.kind === 'latency'
        ? `${(gap / 1000).toFixed(1)}s` // gap is in ms
        : `${Math.round(gap * 100)}%`;
  return { idx: sorted[0].i, text: `+${fmt}` };
}

export function CompareTab({
  history,
  evalT,
  language,
}: {
  history: EvalRunSummary[];
  evalT: EvalTranslationKeys;
  language: Language;
}) {
  const [picked, setPicked] = useState<string[] | null>(null);

  if (history.length < 2) {
    return (
      <div className="py-16 text-center">
        <p className="text-[14px] font-sans text-muted-foreground/60">{evalT.compareNeedRuns}</p>
      </div>
    );
  }

  const compareIds = (picked ?? history.slice(0, 2).map(r => r.id)).filter(id => history.some(r => r.id === id));
  const selected = compareIds.map(id => history.find(r => r.id === id)).filter((r): r is EvalRunSummary => !!r);
  const metrics = selected.map(metricsFromSummary);
  const available = history.filter(r => !compareIds.includes(r.id));

  const remove = (id: string) => setPicked(compareIds.filter(x => x !== id));
  const add = (id: string) => {
    if (compareIds.length >= MAX_RUNS || compareIds.includes(id)) return;
    setPicked([...compareIds, id]);
  };

  const attrs: { label: string; value: (r: EvalRunSummary) => string }[] = [
    { label: evalT.datasetLabel, value: r => r.datasetName ?? '—' },
    { label: evalT.rerankToggleLabel, value: r => (r.useRerank ? evalT.rerankOn : evalT.rerankOff) },
    { label: evalT.attrMode, value: r => (r.mode === 'curated' ? evalT.modeCurated : r.mode) },
    { label: evalT.attrCases, value: r => `${r.passedCases}/${r.totalCases}` },
    { label: evalT.attrDate, value: r => formatDateTime(r.createdAt, language) },
  ];

  return (
    <div className="flex flex-col gap-4 max-w-275">
      {/* run picker */}
      <div className="flex flex-wrap items-center gap-2.5">
        {selected.map((r, i) => (
          <span
            key={r.id}
            className="flex items-center gap-2.5 px-3 py-1.5 border rounded-lg text-[13px] font-sans"
            style={{ borderColor: `color-mix(in srgb, ${RUN_COLORS[i]} 45%, transparent)`, background: `color-mix(in srgb, ${RUN_COLORS[i]} 9%, transparent)` }}
          >
            <span className="w-1.75 h-1.75 rounded-full" style={{ background: RUN_COLORS[i] }} />
            <span className="font-semibold" style={{ color: RUN_COLORS[i] }}>{RUN_LETTERS[i]}</span>
            <span className="text-foreground">{r.datasetName ?? '—'}</span>
            <span className="text-[11px] text-muted-foreground">{formatDateTime(r.createdAt, language)}</span>
            <button
              type="button"
              onClick={() => remove(r.id)}
              aria-label={`${evalT.attrDate} ✕`}
              className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
            >
              ✕
            </button>
          </span>
        ))}
        {selected.length < MAX_RUNS && available.length > 0 && (
          <select
            value=""
            onChange={e => e.target.value && add(e.target.value)}
            aria-label={evalT.compareAddRun}
            className="h-9 border border-dashed border-input bg-card px-3 rounded-lg text-[13px] font-sans text-muted-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">+ {evalT.compareAddRun}</option>
            {available.map(r => (
              <option key={r.id} value={r.id}>
                {r.datasetName ?? '—'} · {formatDateTime(r.createdAt, language)} · {r.useRerank ? evalT.rerankOn : evalT.rerankOff}
              </option>
            ))}
          </select>
        )}
      </div>

      {selected.length < 2 ? (
        <div className="py-12 text-center">
          <p className="text-[14px] font-sans text-muted-foreground/60">{evalT.comparePickHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-4 items-start">
          {/* config matrix */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="text-[14.5px] font-sans font-semibold px-4 pt-3.5 pb-3">{evalT.compareConfigTitle}</div>
            <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px] font-mono">
              <thead>
                <tr className="text-left font-mono text-[10.5px] uppercase text-muted-foreground">
                  <th className="py-2 px-4 font-medium border-t border-border w-[26%]" />
                  {selected.map((r, i) => (
                    <th key={r.id} className="py-2 px-2.5 font-medium border-t border-border" style={{ color: RUN_COLORS[i] }}>
                      {RUN_LETTERS[i]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attrs.map(attr => (
                  <tr key={attr.label}>
                    <td className="py-2.5 px-4 text-muted-foreground border-t border-border font-sans">{attr.label}</td>
                    {selected.map(r => (
                      <td key={r.id} className="p-2.5 text-foreground border-t border-border whitespace-nowrap">
                        {attr.value(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* metric bars */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-[14.5px] font-sans font-semibold mb-1.5">{evalT.compareMetricsTitle}</div>
            {COMPARE_SPECS.map(spec => {
              const ld = lead(spec, metrics);
              return (
                <div key={spec.key} className="py-3 border-t border-border mt-2">
                  <div className="flex items-center justify-between text-[12.5px] font-sans mb-2">
                    <span>{evalT[spec.labelKey]}</span>
                    {ld && (
                      <span className="font-mono text-[11px]" style={{ color: RUN_COLORS[ld.idx] }}>
                        {RUN_LETTERS[ld.idx]} {evalT.compareLeads} {ld.text}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {metrics.map((m, i) => (
                      <div key={selected[i].id} className="flex items-center gap-2.5">
                        <span className="w-3.5 font-mono text-[10px]" style={{ color: RUN_COLORS[i] }}>{RUN_LETTERS[i]}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${barFraction(spec, spec.value(m), metrics) * 100}%`, background: RUN_COLORS[i] }} />
                        </div>
                        <span className="w-11 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{spec.display(m, evalT)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
