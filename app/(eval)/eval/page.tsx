'use client';

import { useState, useEffect } from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { SettingsMenu } from '@/components/settings-menu';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type {
  KnowledgeBase,
  EvalRunResult,
  EvalCaseResult,
} from '@/lib/types';
import type { EvalTranslationKeys } from '@/lib/i18n/translations';
import Link from 'next/link';
import { listDatasetNames } from '@/lib/eval/dataset';

const STYLES = `
  @keyframes eval-reveal {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes eval-number-in {
    from { opacity: 0; transform: translateY(6px) scale(0.94); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
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
  .eval-number-in {
    animation: eval-number-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
`;

function TickRuler({ count = 24 }: { count?: number }) {
  return (
    <div className="flex items-end w-full" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex-1 border-l border-foreground"
          style={{
            height: i % 6 === 0 ? 14 : i % 3 === 0 ? 9 : 5,
            opacity: i % 6 === 0 ? 0.3 : 0.12,
          }}
        />
      ))}
    </div>
  );
}

function MetricPanel({
  label,
  value,
  active,
  delay = 0,
}: {
  label: string;
  value: string;
  active: boolean;
  delay?: number;
}) {
  return (
    <div
      className="eval-reveal bg-card flex flex-col gap-2.5 p-5 overflow-hidden relative"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="text-[11px] font-sans font-medium text-muted-foreground">
        {label}
      </span>
      <span
        key={value}
        className={`text-[2.4rem] leading-none font-sans font-semibold tracking-tight tabular-nums ${active ? 'eval-number-in' : ''}`}
        style={{
          color: active ? 'var(--card-accent-0)' : 'hsl(var(--foreground) / 0.22)',
          transition: 'color 0.4s ease',
        }}
      >
        {value}
      </span>
      <TickRuler count={18} />
    </div>
  );
}

function MetricRow({
  title,
  result,
  active,
  evalT,
}: {
  title: string;
  result: EvalRunResult | null;
  active: boolean;
  evalT: EvalTranslationKeys;
}) {
  const passRate = result ? `${result.passedCases}/${result.totalCases}` : '—';
  const retrievalRate = result ? `${Math.round(result.retrievalHitRate * 100)}%` : '—';
  const citationRate = result ? `${Math.round(result.citationHitRate * 100)}%` : '—';
  const avgLatency = result ? `${result.avgLatencyMs}ms` : '—';

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-sans font-medium text-foreground">
          {title}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        <MetricPanel label={evalT.passedCases}      value={passRate}      active={active} delay={0}   />
        <MetricPanel label={evalT.retrievalHitRate} value={retrievalRate} active={active} delay={80}  />
        <MetricPanel label={evalT.citationHitRate}  value={citationRate}  active={active} delay={160} />
        <MetricPanel label={evalT.avgLatency}       value={avgLatency}    active={active} delay={240} />
      </div>
    </section>
  );
}

function CuratedMetricRow({
  result,
  active,
  evalT,
}: {
  result: EvalRunResult;
  active: boolean;
  evalT: EvalTranslationKeys;
}) {
  const pct = (v: number | undefined): string =>
    typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
  const recall = pct(result.recallAtK?.[5]);
  const precision = pct(result.precisionAtK?.[5]);
  const ndcg = pct(result.ndcgAtK?.[5]);
  const mrrStr =
    typeof result.mrr === 'number' ? result.mrr.toFixed(2) : '—';

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-sans font-medium text-foreground">
          {evalT.curatedMetricsTitle}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        <MetricPanel label={evalT.recallAtK}    value={recall}    active={active} delay={0}   />
        <MetricPanel label={evalT.precisionAtK} value={precision} active={active} delay={80}  />
        <MetricPanel label={evalT.ndcgAtK}      value={ndcg}      active={active} delay={160} />
        <MetricPanel label={evalT.mrr}          value={mrrStr}    active={active} delay={240} />
      </div>
    </section>
  );
}

function GradeBadge({ grade, label }: { grade: number; label: string }) {
  // 0 muted, 1 amber, 2 light green, 3 strong green (mapped onto theme tokens)
  const palette: Record<number, { fg: string; bg: string; bd: string }> = {
    3: {
      fg: 'var(--card-accent-1)',
      bg: 'color-mix(in srgb, var(--card-accent-1) 14%, transparent)',
      bd: 'color-mix(in srgb, var(--card-accent-1) 45%, transparent)',
    },
    2: {
      fg: 'var(--card-accent-1)',
      bg: 'color-mix(in srgb, var(--card-accent-1) 7%, transparent)',
      bd: 'color-mix(in srgb, var(--card-accent-1) 25%, transparent)',
    },
    1: {
      fg: 'hsl(38 92% 45%)',
      bg: 'hsl(38 92% 45% / 0.08)',
      bd: 'hsl(38 92% 45% / 0.3)',
    },
    0: {
      fg: 'hsl(var(--muted-foreground))',
      bg: 'transparent',
      bd: 'hsl(var(--border))',
    },
  };
  const c = palette[grade] ?? palette[0];
  return (
    <span
      className="text-[10px] font-sans font-medium px-1.5 py-0.5 border tabular-nums shrink-0"
      style={{ color: c.fg, backgroundColor: c.bg, borderColor: c.bd }}
      title={`${label} ${grade}`}
    >
      {label} {grade}
    </span>
  );
}

function TopKRow({ hits }: { hits: { k: number; hit: boolean }[] }) {
  return (
    <div className="flex items-center gap-4">
      {hits.map(({ k, hit }) => (
        <span
          key={k}
          className="text-[12px] font-sans tabular-nums"
          style={{
            color: hit ? 'var(--card-accent-1)' : 'hsl(var(--muted-foreground))',
            fontWeight: hit ? 600 : 400,
          }}
        >
          {hit ? '✓' : '–'}&thinsp;k={k}
        </span>
      ))}
    </div>
  );
}

function AnswerPanel({
  label,
  text,
  emptyText,
  accentColor,
}: {
  label: string;
  text: string;
  emptyText?: string;
  accentColor?: string;
}) {
  const isEmpty = !text;
  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center gap-2 mb-1.5">
        {accentColor && (
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5"
            style={{ background: accentColor }}
          />
        )}
        <span className="text-[11px] font-sans font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p
        className={`text-[13px] font-sans leading-relaxed whitespace-pre-wrap pl-3 border-l border-border ${
          isEmpty ? 'text-muted-foreground/70 italic' : 'text-foreground/85'
        }`}
      >
        {isEmpty ? emptyText : text}
      </p>
    </div>
  );
}

function CaseRow({
  index,
  caseResult,
  evalT,
  delay,
}: {
  index: number;
  caseResult: EvalCaseResult;
  evalT: EvalTranslationKeys;
  delay: number;
}) {
  const [showChunks, setShowChunks] = useState(false);

  const failureKeyMap: Record<string, keyof EvalTranslationKeys> = {
    retrieval_miss: 'retrieval_miss',
    citation_miss: 'citation_miss',
    pipeline_error: 'pipeline_error',
  };

  const passColor = 'var(--card-accent-1)';
  const failColor = 'hsl(var(--destructive))';
  const accentColor = caseResult.passed ? passColor : failColor;

  return (
    <div
      className="eval-reveal bg-card border border-border overflow-hidden"
      style={{ borderLeft: `3px solid ${accentColor}`, borderRadius: 0, animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-[12px] font-sans text-muted-foreground tabular-nums mt-0.5 shrink-0">
            {String(index + 1).padStart(2, '0')}
          </span>
          <p className="text-[14px] font-sans leading-snug text-foreground">
            {caseResult.question}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] font-sans text-muted-foreground tabular-nums">
            {caseResult.latencyMs}ms
          </span>
          <span
            className="text-[11px] font-sans font-medium px-2 py-1 border"
            style={{
              color: accentColor,
              borderColor: `color-mix(in srgb, ${accentColor} 35%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${accentColor} 7%, transparent)`,
            }}
          >
            {caseResult.passed ? evalT.pass : evalT.fail}
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3 pt-3">
        {caseResult.failureReasons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {caseResult.failureReasons.map(reason => {
              const key = failureKeyMap[reason] ?? 'pipeline_error';
              return (
                <span
                  key={reason}
                  className="text-[11px] font-sans px-2 py-0.5 border"
                  style={{
                    color: failColor,
                    borderColor: 'hsl(var(--destructive) / 0.3)',
                    backgroundColor: 'hsl(var(--destructive) / 0.06)',
                  }}
                >
                  {evalT[key] as string}
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-4">
          <span className="text-[12px] font-sans text-muted-foreground shrink-0">
            {evalT.topKLabel}
          </span>
          <TopKRow hits={caseResult.topKHits} />
        </div>

        <div>
          <button
            onClick={() => setShowChunks(v => !v)}
            className="cursor-pointer text-[12px] font-sans text-muted-foreground hover:text-foreground transition-colors focus:outline-none flex items-center gap-2"
          >
            <span className="w-2.5 inline-block">{showChunks ? '−' : '+'}</span>
            {evalT.retrievedChunksLabel} ({caseResult.retrievedChunks.length})
          </button>
          {showChunks && (
            <div className="mt-2.5 space-y-2">
              {caseResult.retrievedChunks.length === 0 ? (
                <p className="text-[12px] font-sans text-muted-foreground italic pl-4">
                  {evalT.noChunksRetrieved}
                </p>
              ) : (
                caseResult.retrievedChunks.map((chunk, i) => {
                  const grade = caseResult.gradedHits?.[i];
                  return (
                    <div key={chunk.chunkId} className="pl-4 border-l border-border">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[12px] font-sans text-muted-foreground tabular-nums">
                          [{String(i + 1).padStart(2, '0')}] {chunk.fileName}
                        </p>
                        {typeof grade === 'number' && (
                          <GradeBadge grade={grade} label={evalT.gradeLabel} />
                        )}
                      </div>
                      <p className="text-[13px] font-sans text-foreground/75 line-clamp-2 leading-relaxed mt-0.5">
                        {chunk.textPreview}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <AnswerPanel
            label={evalT.expectedAnswerLabel}
            text={caseResult.expectedAnswer ?? ''}
            emptyText={evalT.noExpectedAnswer}
            accentColor="hsl(var(--muted-foreground) / 0.5)"
          />
          <AnswerPanel
            label={evalT.generatedAnswerLabel}
            text={caseResult.answer}
            accentColor={accentColor}
          />
        </div>
      </div>
    </div>
  );
}

function ScanSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-20 border border-border bg-card relative overflow-hidden"
          style={{ opacity: 1 - i * 0.15 }}
        >
          <div
            className="absolute inset-y-0 w-1/5"
            style={{
              background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--card-accent-0) 40%, transparent), transparent)',
              animation: `eval-scan 2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default function EvalPage() {
  const { evalT, home } = useLanguage();

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [selectedKbId, setSelectedKbId] = useState('');
  const [selectedDataset, setSelectedDataset] = useState('');
  const [useRerank, setUseRerank] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<EvalRunResult | null>(null);
  const [runError, setRunError] = useState('');
  const datasetNames = listDatasetNames();

  useEffect(() => {
    fetch('/api/knowledge-bases')
      .then(r => r.json())
      .then((d: { ok: boolean; data?: { knowledgeBases: KnowledgeBase[] } }) => {
        if (d.ok && d.data) setKnowledgeBases(d.data.knowledgeBases);
      })
      .catch(() => { })
      .finally(() => setLoadingKbs(false));
  }, []);

  async function handleRunEval(): Promise<void> {
    if (!selectedKbId || isRunning) return;
    setIsRunning(true);
    setRunError('');
    setResult(null);
    try {
      const body: Record<string, unknown> = { knowledgeBaseId: selectedKbId, useRerank };
      if (selectedDataset) {
        body.mode = 'curated';
        body.datasetName = selectedDataset;
      }
      const res = await fetch('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; data?: EvalRunResult; error?: string };
      if (data.ok && data.data) {
        setResult(data.data);
      } else {
        const code = data.error;
        setRunError(code === 'eval_no_chunks' ? evalT.errorNoChunks : evalT.errorRunning);
      }
    } catch {
      setRunError(evalT.errorRunning);
    } finally {
      setIsRunning(false);
    }
  }

  const hasResult = !!result;
  const sectionTitle = useRerank ? evalT.withRerank : evalT.withoutRerank;

  return (
    <>
      <style>{STYLES}</style>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 flex h-13 items-center justify-between border-b border-border bg-background px-5">
          <Link href="/">
            <BrandLogo name={home.title} iconSize={28} />
          </Link>
          <SettingsMenu />
        </header>
        <div className="container mx-auto py-12 px-6 max-w-4xl space-y-10">

          {/* ── Header ── */}
          <header className="space-y-4">
            <div className="flex items-baseline gap-5">
              <h1 className="text-[3rem] leading-none font-sans font-semibold tracking-tight">
                {evalT.title}
              </h1>
              <div
                className="flex-1 h-px self-center"
                style={{ background: 'linear-gradient(90deg, hsl(var(--foreground) / 0.18), transparent)' }}
              />
              <span className="text-[12px] font-sans text-muted-foreground self-end pb-1">
                RAG · Pipeline
              </span>
            </div>
            <p className="text-[14px] font-sans text-muted-foreground leading-relaxed max-w-lg">
              {evalT.description}
            </p>
            <TickRuler count={32} />
          </header>

          {/* ── Controls ── */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <div className="flex-1">
              {loadingKbs ? (
                <div className="h-10 border border-border bg-card animate-pulse" />
              ) : knowledgeBases.length === 0 ? (
                <p className="text-sm font-sans text-muted-foreground">{evalT.noKnowledgeBases}</p>
              ) : (
                <select
                  value={selectedKbId}
                  onChange={e => setSelectedKbId(e.target.value)}
                  aria-label={evalT.selectKnowledgeBase}
                  className="w-full h-10 border border-input bg-background px-3 text-[14px] font-sans focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                  style={{ borderRadius: 0 }}
                >
                  <option value="">{evalT.selectPlaceholder}</option>
                  {knowledgeBases.map(kb => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label
              htmlFor="dataset-select"
              className="h-10 flex items-center gap-2 border border-border bg-card pl-3 pr-1 cursor-pointer select-none"
              style={{ borderRadius: 0 }}
            >
              <span className="text-[13px] font-sans font-medium text-foreground">
                {evalT.datasetLabel}
              </span>
              <select
                id="dataset-select"
                value={selectedDataset}
                onChange={e => setSelectedDataset(e.target.value)}
                disabled={isRunning}
                className="h-8 bg-transparent px-2 text-[13px] font-sans focus:outline-none cursor-pointer disabled:cursor-not-allowed"
                style={{ borderRadius: 0 }}
              >
                <option value="">{evalT.datasetAuto}</option>
                {datasetNames.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label
              htmlFor="rerank-toggle"
              className="h-10 flex items-center gap-3 border border-border bg-card px-4 cursor-pointer select-none"
              style={{ borderRadius: 0 }}
            >
              <span className="text-[13px] font-sans font-medium text-foreground">
                {evalT.rerankToggleLabel}
              </span>
              <Switch
                id="rerank-toggle"
                checked={useRerank}
                onCheckedChange={setUseRerank}
                disabled={isRunning}
              />
              <span className="text-[12px] font-sans text-muted-foreground tabular-nums w-8">
                {useRerank ? evalT.rerankOn : evalT.rerankOff}
              </span>
            </label>
            <button
              onClick={handleRunEval}
              disabled={!selectedKbId || isRunning}
              className="h-10 cursor-pointer px-7 text-[13px] font-sans font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus:outline-none"
              style={{
                background: !selectedKbId || isRunning ? 'hsl(var(--muted))' : 'var(--card-accent-0)',
                color: !selectedKbId || isRunning ? 'hsl(var(--muted-foreground))' : 'hsl(0 0% 100%)',
                borderRadius: 0,
              }}
            >
              {isRunning ? (
                <span className="flex items-center gap-2.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-current"
                    style={{ animation: 'eval-dot-pulse 0.9s ease-in-out infinite' }}
                  />
                  {evalT.running}
                </span>
              ) : (
                evalT.runEval
              )}
            </button>
          </div>

          {/* ── Error ── */}
          {runError && (
            <p className="text-[14px] font-sans text-destructive">{runError}</p>
          )}

          {/* ── Metric gauges ── */}
          <MetricRow
            title={sectionTitle}
            result={result}
            active={hasResult}
            evalT={evalT}
          />

          {/* ── Curated retrieval metrics (only in curated mode) ── */}
          {result && result.mode === 'curated' && (
            <CuratedMetricRow result={result} active={hasResult} evalT={evalT} />
          )}

          {/* ── Running skeleton ── */}
          {isRunning && <ScanSkeleton />}

          {/* ── Case results ── */}
          {result && !isRunning && result.cases.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[12px] font-sans font-medium text-muted-foreground">
                  {evalT.casesTitle}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                {result.cases.map((c, i) => (
                  <CaseRow
                    key={c.caseId}
                    index={i}
                    caseResult={c}
                    evalT={evalT}
                    delay={i * 55}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Empty state ── */}
          {!result && !isRunning && !runError && (
            <div className="py-16 text-center">
              <p className="text-[14px] font-sans text-muted-foreground/60">
                {evalT.noResultsYet}
              </p>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
