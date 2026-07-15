'use client';

import type { EvalRunResult, EvalRunSummary, RetrievalFileType, RetrievalFilter } from '@/lib/types';
import type { EvalTranslationKeys, Language } from '@/lib/i18n/translations';
import {
  METRIC_SPECS,
  MetricPanel,
  metricDelta,
  metricsFromResult,
  metricsFromSummary,
  GOOD,
  BAD,
  GOLD,
  type MetricSpec,
} from './shared';
import { formatDateTime } from '@/lib/format';
import { TrendChart, ScatterChart } from './charts';

/** The five hero metrics shown as cards. */
const HERO_KEYS = ['faithfulness', 'answerRelevance', 'precision', 'recall', 'latency'];
const HERO_SPECS = HERO_KEYS.map(k => METRIC_SPECS.find(s => s.key === k)).filter((s): s is MetricSpec => !!s);

/** Curated leaderboard columns (mirrors the design; $/q dropped — no cost data). */
const LEADERBOARD_KEYS = ['faithfulness', 'answerRelevance', 'precision', 'recall', 'retrieval', 'mrr', 'latency'];
const LEADERBOARD_SPECS = LEADERBOARD_KEYS.map(k => METRIC_SPECS.find(s => s.key === k)).filter((s): s is MetricSpec => !!s);

const RANK_DOT = [GOOD, GOLD, 'hsl(var(--muted-foreground))'];

/** Tooltip summary of a run's retrieval filter, one part per active dimension. */
function filterSummary(filter: RetrievalFilter, evalT: EvalTranslationKeys): string {
  const typeLabels: Record<RetrievalFileType, string> = {
    pdf: evalT.filterTypePdf,
    markdown: evalT.filterTypeMarkdown,
    word: evalT.filterTypeWord,
    text: evalT.filterTypeText,
  };
  const parts: string[] = [];
  if (filter.fileIds?.length) {
    parts.push(evalT.filterTooltipFiles.replace('{count}', String(filter.fileIds.length)));
  }
  if (filter.fileTypes?.length) {
    parts.push(evalT.filterTooltipTypes.replace('{list}', filter.fileTypes.map(t => typeLabels[t]).join(', ')));
  }
  if (filter.titleQuery) {
    parts.push(evalT.filterTooltipTitle.replace('{query}', filter.titleQuery));
  }
  return parts.join(' · ');
}

function bestValue(spec: MetricSpec, rows: EvalRunSummary[]): number | null {
  const vals = rows.map(r => spec.value(metricsFromSummary(r))).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return spec.higherIsBetter ? Math.max(...vals) : Math.min(...vals);
}

function Leaderboard({
  history,
  evalT,
  language,
  currentRunId,
  onSelectRun,
}: {
  history: EvalRunSummary[];
  evalT: EvalTranslationKeys;
  language: Language;
  currentRunId?: string;
  onSelectRun: (id: string) => void;
}) {
  const best = new Map(LEADERBOARD_SPECS.map(s => [s.key, bestValue(s, history)]));
  // Match the leaderboard caption: faithfulness desc, nulls last.
  const rows = [...history].sort((a, b) => (b.avgFaithfulness ?? -1) - (a.avgFaithfulness ?? -1));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <span className="text-[14.5px] font-sans font-semibold">{evalT.leaderboardTitle}</span>
        <span className="text-[11.5px] font-sans text-muted-foreground">
          {evalT.leaderboardMeta.replace('{count}', String(history.length))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-right font-mono text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground">
              <th className="text-left font-medium py-2.5 px-4 border-t border-border">{evalT.leaderboardConfig}</th>
              {LEADERBOARD_SPECS.map(s => (
                <th key={s.key} className="font-medium py-2.5 px-2.5 border-t border-border whitespace-nowrap">
                  {evalT[s.labelKey]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((run, ri) => {
              const m = metricsFromSummary(run);
              const isCurrent = run.id === currentRunId;
              return (
                <tr
                  key={run.id}
                  onClick={() => onSelectRun(run.id)}
                  className="text-right cursor-pointer transition-colors hover:bg-muted/40"
                  style={isCurrent ? { background: 'color-mix(in srgb, hsl(var(--primary)) 6%, transparent)' } : undefined}
                >
                  <td className="text-left py-2.5 px-4 border-t border-border">
                    <div className="flex items-center gap-2.5 font-sans text-[13px]">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: RANK_DOT[ri] ?? 'hsl(var(--muted-foreground) / 0.5)' }} />
                      <span className="text-foreground">{run.datasetName ?? '—'}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(run.createdAt, language)} · {run.useRerank ? evalT.rerankOn : evalT.rerankOff}
                      </span>
                      {run.filter && (
                        <span
                          className="font-mono text-[9.5px] rounded-md px-1.5 py-px border border-border text-muted-foreground"
                          title={filterSummary(run.filter, evalT)}
                        >
                          {evalT.filterActiveBadge}
                        </span>
                      )}
                      {ri === 0 && history.length > 1 && (
                        <span
                          className="font-mono text-[9.5px] rounded-md px-1.5 py-px ml-0.5"
                          style={{ color: GOOD, border: '1px solid color-mix(in srgb, hsl(var(--primary)) 35%, transparent)', background: 'color-mix(in srgb, hsl(var(--primary)) 10%, transparent)' }}
                        >
                          {evalT.bestLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  {LEADERBOARD_SPECS.map(s => {
                    const v = s.value(m);
                    const b = best.get(s.key) ?? null;
                    const isBest = v != null && b != null && v === b && history.length > 1;
                    return (
                      <td
                        key={s.key}
                        className="py-2.5 px-2.5 border-t border-border whitespace-nowrap"
                        style={isBest ? { color: GOOD, fontWeight: 600 } : s.kind === 'latency' ? { color: 'hsl(var(--muted-foreground))' } : undefined}
                      >
                        {s.display(m, evalT)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OverviewTab({
  result,
  history,
  baseline,
  evalT,
  language,
  onSelectRun,
}: {
  result: EvalRunResult | null;
  history: EvalRunSummary[];
  baseline: EvalRunSummary | null;
  evalT: EvalTranslationKeys;
  language: Language;
  onSelectRun: (id: string) => void;
}) {
  const curMetrics = result ? metricsFromResult(result) : null;
  const baseMetrics = baseline && baseline.id !== result?.runId ? metricsFromSummary(baseline) : null;
  const chrono = [...history].reverse();
  const sparkFor = (spec: MetricSpec): number[] =>
    chrono.map(s => spec.value(metricsFromSummary(s))).filter((v): v is number => v != null);
  const sparkColorFor = (spec: MetricSpec, vals: number[]): string => {
    if (vals.length < 2) return GOOD;
    const trend = vals[vals.length - 1] - vals[0];
    const improving = spec.higherIsBetter ? trend >= 0 : trend <= 0;
    return improving ? GOOD : BAD;
  };

  if (!curMetrics && history.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[14px] font-sans text-muted-foreground/60">{evalT.overviewEmpty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-295">
      {curMetrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {HERO_SPECS.map((spec, i) => {
            const spark = sparkFor(spec);
            return (
              <MetricPanel
                key={spec.key}
                label={evalT[spec.labelKey]}
                value={spec.display(curMetrics, evalT)}
                delta={baseMetrics ? metricDelta(spec, curMetrics, baseMetrics) : undefined}
                deltaLabel={evalT.vsBaseline}
                spark={spark}
                sparkColor={sparkColorFor(spec, spark)}
                gradId={`spark-${spec.key}`}
                delay={i * 50}
              />
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
            <TrendChart history={history} evalT={evalT} />
            <ScatterChart history={history} evalT={evalT} />
          </div>

          <Leaderboard
            history={history}
            evalT={evalT}
            language={language}
            currentRunId={result?.runId}
            onSelectRun={onSelectRun}
          />
        </>
      )}
    </div>
  );
}
