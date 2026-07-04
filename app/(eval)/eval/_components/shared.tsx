'use client';

import { useState } from 'react';
import type {
  EvalRunResult,
  EvalCaseResult,
  EvalRunSummary,
  EvalRunDetail,
} from '@/lib/types';
import type { EvalTranslationKeys, Language } from '@/lib/i18n/translations';

/* ───────────────────────── palette (token-mapped) ───────────────────────── */

export const GOOD = 'hsl(var(--primary))';        // forest green
export const BAD = 'var(--card-accent-2)';        // terracotta
export const GOLD = 'var(--card-accent-0)';       // amber/gold — KPI numbers
export const MUTED = 'hsl(var(--muted-foreground))';

/* ───────────────────────── animation keyframes ───────────────────────── */

export const EVAL_STYLES = `
  @keyframes eval-reveal {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes eval-scan {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(500%); }
  }
  @keyframes eval-dot-pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.75); }
    50%       { opacity: 1;   transform: scale(1.1); }
  }
  .eval-reveal {
    opacity: 0;
    animation: eval-reveal 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .eval-select {
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    background-size: 0.875rem;
  }
`;

/* ───────────────────────── formatting helpers ───────────────────────── */

export function formatRunDate(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function baselineLabel(
  r: EvalRunSummary,
  language: Language,
  evalT: EvalTranslationKeys,
): string {
  const rerank = r.useRerank ? evalT.rerankOn : evalT.rerankOff;
  return `${formatRunDate(r.createdAt, language)} · ${r.datasetName ?? ''} · ${rerank} · ${r.passedCases}/${r.totalCases}`;
}

function at5(
  m: Record<string, number> | Record<number, number> | null | undefined,
): number | null {
  return m == null ? null : (m as Record<number, number>)[5] ?? null;
}

/** Reshape a persisted run detail into the live `EvalRunResult` render shape. */
export function detailToResult(run: EvalRunDetail): EvalRunResult {
  return {
    runId: run.id,
    knowledgeBaseId: run.knowledgeBaseId,
    totalCases: run.totalCases,
    passedCases: run.passedCases,
    retrievalHitRate: run.retrievalHitRate,
    citationHitRate: run.citationHitRate,
    avgLatencyMs: run.avgLatencyMs,
    recallAtK: run.recallAtK ?? undefined,
    precisionAtK: run.precisionAtK ?? undefined,
    ndcgAtK: run.ndcgAtK ?? undefined,
    mrr: run.mrr ?? undefined,
    avgFaithfulness: run.avgFaithfulness ?? null,
    avgAnswerRelevance: run.avgAnswerRelevance ?? null,
    mode: 'curated',
    datasetHash: run.datasetHash ?? undefined,
    cases: run.items.map(it => ({
      caseId: it.caseKey,
      question: it.question,
      passed: it.passed,
      failureReasons: it.failureReasons ?? [],
      retrievalHit: it.retrievalHit,
      citationHit: it.citationHit,
      latencyMs: it.latencyMs,
      retrievedChunks: it.retrievedChunks ?? [],
      topKHits: it.topKHits ?? [],
      answer: it.answer ?? '',
      expectedAnswer: it.expectedAnswer ?? undefined,
      gradedHits: it.gradedHits ?? undefined,
      faithfulness: it.faithfulness ?? null,
      answerRelevance: it.answerRelevance ?? null,
    })),
  };
}

/* ───────────────────────── metric model ─────────────────────────────── */

/** Normalised per-run metrics, extracted from either a summary or a live result. */
export interface RunMetrics {
  passed: number;
  total: number;
  passRate: number | null;
  faithfulness: number | null;
  answerRelevance: number | null;
  retrievalHitRate: number;
  citationHitRate: number;
  recall: number | null;
  precision: number | null;
  ndcg: number | null;
  mrr: number | null;
  avgLatencyMs: number;
}

export function metricsFromSummary(s: EvalRunSummary): RunMetrics {
  return {
    passed: s.passedCases,
    total: s.totalCases,
    passRate: s.totalCases > 0 ? s.passedCases / s.totalCases : null,
    faithfulness: s.avgFaithfulness,
    answerRelevance: s.avgAnswerRelevance,
    retrievalHitRate: s.retrievalHitRate,
    citationHitRate: s.citationHitRate,
    recall: at5(s.recallAtK),
    precision: at5(s.precisionAtK),
    ndcg: at5(s.ndcgAtK),
    mrr: s.mrr,
    avgLatencyMs: s.avgLatencyMs,
  };
}

export function metricsFromResult(r: EvalRunResult): RunMetrics {
  return {
    passed: r.passedCases,
    total: r.totalCases,
    passRate: r.totalCases > 0 ? r.passedCases / r.totalCases : null,
    faithfulness: r.avgFaithfulness ?? null,
    answerRelevance: r.avgAnswerRelevance ?? null,
    retrievalHitRate: r.retrievalHitRate,
    citationHitRate: r.citationHitRate,
    recall: at5(r.recallAtK),
    precision: at5(r.precisionAtK),
    ndcg: at5(r.ndcgAtK),
    mrr: r.mrr ?? null,
    avgLatencyMs: r.avgLatencyMs,
  };
}

export type MetricKind = 'rate' | 'latency' | 'scalar';

export interface MetricSpec {
  key: string;
  labelKey: keyof EvalTranslationKeys;
  value: (m: RunMetrics) => number | null;
  display: (m: RunMetrics, t: EvalTranslationKeys) => string;
  higherIsBetter: boolean;
  kind: MetricKind;
}

const pct = (v: number | null): string =>
  v == null ? '—' : `${Math.round(v * 100)}%`;
const scalar2 = (v: number | null): string =>
  v == null ? '—' : v.toFixed(2);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** Single source of truth for the metrics shown across Overview / Leaderboard / Compare. */
export const METRIC_SPECS: MetricSpec[] = [
  { key: 'passRate', labelKey: 'passRate', value: m => m.passRate, display: m => `${m.passed}/${m.total}`, higherIsBetter: true, kind: 'rate' },
  { key: 'faithfulness', labelKey: 'faithfulness', value: m => m.faithfulness, display: m => scalar2(m.faithfulness), higherIsBetter: true, kind: 'scalar' },
  { key: 'answerRelevance', labelKey: 'answerRelevance', value: m => m.answerRelevance, display: m => scalar2(m.answerRelevance), higherIsBetter: true, kind: 'scalar' },
  { key: 'retrieval', labelKey: 'retrievalHitRate', value: m => m.retrievalHitRate, display: m => pct(m.retrievalHitRate), higherIsBetter: true, kind: 'rate' },
  { key: 'citation', labelKey: 'citationHitRate', value: m => m.citationHitRate, display: m => pct(m.citationHitRate), higherIsBetter: true, kind: 'rate' },
  { key: 'recall', labelKey: 'recallAtK', value: m => m.recall, display: m => pct(m.recall), higherIsBetter: true, kind: 'rate' },
  { key: 'precision', labelKey: 'precisionAtK', value: m => m.precision, display: m => pct(m.precision), higherIsBetter: true, kind: 'rate' },
  { key: 'ndcg', labelKey: 'ndcgAtK', value: m => m.ndcg, display: m => pct(m.ndcg), higherIsBetter: true, kind: 'rate' },
  { key: 'mrr', labelKey: 'mrr', value: m => m.mrr, display: m => scalar2(m.mrr), higherIsBetter: true, kind: 'scalar' },
  { key: 'latency', labelKey: 'avgLatency', value: m => m.avgLatencyMs, display: m => secs(m.avgLatencyMs), higherIsBetter: false, kind: 'latency' },
];

/* ───────────────────────── deltas ───────────────────────── */

export type MetricDelta = { text: string; tone: 'good' | 'bad' | 'flat' };

function signed(n: number, format: (abs: number) => string): string {
  const mark = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${mark}${format(Math.abs(n))}`;
}

/** Delta for a metric spec between a current and baseline RunMetrics. */
export function metricDelta(
  spec: MetricSpec,
  cur: RunMetrics,
  base: RunMetrics,
): MetricDelta | undefined {
  const c = spec.value(cur);
  const b = spec.value(base);
  if (c == null || b == null) return undefined;
  if (spec.kind === 'latency') {
    const s = Math.round((c - b) / 10) / 100;
    return { text: signed(s, abs => `${abs.toFixed(2)}s`), tone: s === 0 ? 'flat' : s < 0 ? 'good' : 'bad' };
  }
  if (spec.kind === 'scalar') {
    const d = Math.round((c - b) * 100) / 100;
    return { text: signed(d, abs => abs.toFixed(2).replace(/^0/, '')), tone: d === 0 ? 'flat' : d > 0 ? 'good' : 'bad' };
  }
  const pts = Math.round((c - b) * 100);
  return { text: signed(pts, abs => `${abs}%`), tone: pts === 0 ? 'flat' : pts > 0 ? 'good' : 'bad' };
}

export function DeltaTag({ delta, label }: { delta: MetricDelta; label: string }) {
  const color = delta.tone === 'good' ? GOOD : delta.tone === 'bad' ? BAD : MUTED;
  return (
    <span className="text-[11.5px] font-sans font-semibold tabular-nums" style={{ color }} title={label}>
      {delta.text}
    </span>
  );
}

/* ───────────────────────── primitives ───────────────────────── */

/** Tiny inline trend line + soft gradient fill; values normalised by their own min/max. */
export function Sparkline({
  values,
  color = GOOD,
  gradId,
  height = 30,
}: {
  values: number[];
  color?: string;
  gradId: string;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ height }} aria-hidden />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(' ');
  const area = `0,${height} ${line} ${w},${height}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MetricPanel({
  label,
  value,
  delta,
  deltaLabel,
  spark,
  sparkColor = GOOD,
  gradId,
  delay = 0,
}: {
  label: string;
  value: string;
  delta?: MetricDelta;
  deltaLabel?: string;
  spark?: number[];
  sparkColor?: string;
  gradId: string;
  delay?: number;
}) {
  return (
    <div className="eval-reveal bg-card border border-border rounded-xl p-4 flex flex-col" style={{ animationDelay: `${delay}ms` }}>
      <span className="text-[11.5px] font-sans text-muted-foreground mb-2.5">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] leading-none font-mono font-semibold tracking-[-0.02em] tabular-nums" style={{ color: GOLD }}>
          {value}
        </span>
        {delta && deltaLabel && <DeltaTag delta={delta} label={deltaLabel} />}
      </div>
      <div className="mt-2">
        {spark && spark.length >= 2 ? (
          <Sparkline values={spark} color={sparkColor} gradId={gradId} />
        ) : (
          <div style={{ height: 30 }} aria-hidden />
        )}
      </div>
    </div>
  );
}

export function GradeBadge({ grade, label }: { grade: number; label: string }) {
  const palette: Record<number, { fg: string; bg: string; bd: string }> = {
    3: {
      fg: GOOD,
      bg: 'color-mix(in srgb, hsl(var(--primary)) 12%, transparent)',
      bd: 'color-mix(in srgb, hsl(var(--primary)) 40%, transparent)',
    },
    2: {
      fg: GOOD,
      bg: 'color-mix(in srgb, hsl(var(--primary)) 7%, transparent)',
      bd: 'color-mix(in srgb, hsl(var(--primary)) 25%, transparent)',
    },
    1: { fg: GOLD, bg: 'color-mix(in srgb, var(--card-accent-0) 10%, transparent)', bd: 'color-mix(in srgb, var(--card-accent-0) 35%, transparent)' },
    0: { fg: 'hsl(var(--muted-foreground))', bg: 'transparent', bd: 'hsl(var(--border))' },
  };
  const c = palette[grade] ?? palette[0];
  return (
    <span
      className="text-[10px] font-mono font-medium px-1.5 py-0.5 border rounded-md tabular-nums shrink-0"
      style={{ color: c.fg, backgroundColor: c.bg, borderColor: c.bd }}
      title={`${label} ${grade}`}
    >
      {label} {grade}
    </span>
  );
}

export function TopKRow({ hits }: { hits: { k: number; hit: boolean }[] }) {
  return (
    <div className="flex items-center gap-4">
      {hits.map(({ k, hit }) => (
        <span
          key={k}
          className="text-[12px] font-mono tabular-nums"
          style={{ color: hit ? GOOD : 'hsl(var(--muted-foreground))', fontWeight: hit ? 600 : 400 }}
        >
          {hit ? '✓' : '–'}&thinsp;k={k}
        </span>
      ))}
    </div>
  );
}

export function AnswerPanel({
  label,
  text,
  emptyText,
}: {
  label: string;
  text: string;
  emptyText?: string;
}) {
  const isEmpty = !text;
  return (
    <div className="flex flex-col min-w-0">
      <div className="text-[10.5px] font-mono font-medium uppercase tracking-wide text-muted-foreground mb-2.5">{label}</div>
      <p
        className={`text-[12.5px] font-sans leading-relaxed whitespace-pre-wrap ${
          isEmpty ? 'text-muted-foreground/70 italic' : 'text-foreground/85'
        }`}
      >
        {isEmpty ? emptyText : text}
      </p>
    </div>
  );
}

/** Grade colour for a retrieved chunk: high relevance = green, weak = gold, none = muted. */
function chunkTone(grade: number | undefined): { bg: string; bd: string; score: string } {
  if (grade != null && grade >= 2) {
    return {
      bg: 'color-mix(in srgb, hsl(var(--primary)) 8%, transparent)',
      bd: 'color-mix(in srgb, hsl(var(--primary)) 30%, transparent)',
      score: GOOD,
    };
  }
  if (grade === 1) {
    return {
      bg: 'color-mix(in srgb, var(--card-accent-0) 8%, transparent)',
      bd: 'color-mix(in srgb, var(--card-accent-0) 30%, transparent)',
      score: GOLD,
    };
  }
  return { bg: 'hsl(var(--muted) / 0.4)', bd: 'hsl(var(--border))', score: MUTED };
}

/** Retrieved-chunk list with relevance grades; collapsible. */
export function RetrievedChunks({
  caseResult,
  evalT,
}: {
  caseResult: EvalCaseResult;
  evalT: EvalTranslationKeys;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="cursor-pointer text-[12px] font-sans text-muted-foreground hover:text-foreground transition-colors focus:outline-none flex items-center gap-2"
      >
        <span className="w-2.5 inline-block">{open ? '−' : '+'}</span>
        {evalT.retrievedChunksLabel} ({caseResult.retrievedChunks.length})
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {caseResult.retrievedChunks.length === 0 ? (
            <p className="text-[12px] font-sans text-muted-foreground italic pl-1">{evalT.noChunksRetrieved}</p>
          ) : (
            caseResult.retrievedChunks.map((chunk, i) => {
              const grade = caseResult.gradedHits?.[i];
              const tone = chunkTone(grade);
              return (
                <div key={chunk.chunkId} className="flex gap-3 p-3 rounded-[10px] border" style={{ background: tone.bg, borderColor: tone.bd }}>
                  <div className="font-mono text-[12px] font-semibold w-9 shrink-0 tabular-nums" style={{ color: tone.score }}>
                    {typeof grade === 'number' ? grade : '–'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-[11px] font-mono text-muted-foreground tabular-nums">
                        [{String(i + 1).padStart(2, '0')}] {chunk.fileName}
                      </p>
                      {typeof grade === 'number' && <GradeBadge grade={grade} label={evalT.gradeLabel} />}
                    </div>
                    <p className="text-[12.5px] font-sans text-foreground/75 line-clamp-2 leading-relaxed">
                      {chunk.textPreview}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function ScanSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-20 border border-border bg-card rounded-xl relative overflow-hidden" style={{ opacity: 1 - i * 0.15 }}>
          <div
            className="absolute inset-y-0 w-1/5"
            style={{
              background: 'linear-gradient(90deg, transparent, color-mix(in srgb, hsl(var(--primary)) 30%, transparent), transparent)',
              animation: `eval-scan 2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
