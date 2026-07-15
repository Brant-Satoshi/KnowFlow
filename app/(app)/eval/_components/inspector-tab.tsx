'use client';

import { useMemo, useState } from 'react';
import type { EvalRunResult, EvalRunSummary, EvalCaseResult } from '@/lib/types';
import type { EvalTranslationKeys, Language } from '@/lib/i18n/translations';
import { AnswerPanel, RetrievedChunks, baselineLabel, GOOD, BAD, GOLD } from './shared';

type Filter = 'all' | 'pass' | 'fail';

function scoreColor(value: number | null): string {
  if (value == null) return 'hsl(var(--muted-foreground))';
  if (value < 0.5) return BAD;
  if (value < 0.7) return GOLD;
  return GOOD;
}

function ScoreCell({ label, value, notJudged }: { label: string; value: number | null; notJudged: string }) {
  const color = scoreColor(value);
  return (
    <div>
      <div className="text-[11px] font-sans text-muted-foreground mb-1.5">{label}</div>
      <div className="text-[20px] font-mono font-semibold tabular-nums" style={{ color }} title={value == null ? notJudged : undefined}>
        {value == null ? '—' : value.toFixed(2)}
      </div>
      <div className="h-1.5 mt-1.5 bg-muted rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${(value ?? 0) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function HitCell({ label, hit, yes, no }: { label: string; hit: boolean; yes: string; no: string }) {
  return (
    <div>
      <div className="text-[11px] font-sans text-muted-foreground mb-1.5">{label}</div>
      <div className="text-[20px] font-mono font-semibold" style={{ color: hit ? GOOD : BAD }}>{hit ? '✓' : '✗'}</div>
      <div className="text-[11px] font-sans text-muted-foreground mt-1">{hit ? yes : no}</div>
    </div>
  );
}

function QueryDetail({ c, evalT }: { c: EvalCaseResult; evalT: EvalTranslationKeys }) {
  const accent = c.passed ? GOOD : BAD;
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card border border-border rounded-xl p-4.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] uppercase text-muted-foreground mb-1.5">
              {evalT.queryLabel} · {c.caseId}
            </div>
            <div className="text-[19px] font-sans font-semibold leading-snug tracking-[-0.01em]">{c.question}</div>
          </div>
          <span
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[11.5px] whitespace-nowrap"
            style={{ color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`, background: `color-mix(in srgb, ${accent} 9%, transparent)` }}
          >
            <span className="w-1.75 h-1.75 rounded-full" style={{ background: accent }} />
            {c.passed ? evalT.pass : evalT.fail}
          </span>
        </div>
        <div className="mt-2 font-mono text-[11px] text-muted-foreground tabular-nums">{(c.latencyMs / 1000).toFixed(1)}s</div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4.5">
        <div className="text-[14.5px] font-sans font-semibold mb-3">{evalT.retrievedChunksLabel}</div>
        <RetrievedChunks caseResult={c} evalT={evalT} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <AnswerPanel label={evalT.generatedAnswerLabel} text={c.answer} />
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <AnswerPanel label={evalT.expectedAnswerLabel} text={c.expectedAnswer ?? ''} emptyText={evalT.noExpectedAnswer} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4.5">
        <div className="text-[14.5px] font-sans font-semibold mb-3.5">{evalT.scorecardTitle}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ScoreCell label={evalT.faithfulness} value={c.faithfulness ?? null} notJudged={evalT.notJudged} />
          <ScoreCell label={evalT.answerRelevance} value={c.answerRelevance ?? null} notJudged={evalT.notJudged} />
          <HitCell label={evalT.retrievalHitRate} hit={c.retrievalHit} yes={evalT.pass} no={evalT.retrieval_miss} />
          <HitCell label={evalT.citationHitRate} hit={c.citationHit} yes={evalT.pass} no={evalT.citation_miss} />
        </div>
      </div>
    </div>
  );
}

function RunPicker({
  history,
  currentRunId,
  onSelectRun,
  language,
  evalT,
}: {
  history: EvalRunSummary[];
  currentRunId?: string;
  onSelectRun: (id: string) => void;
  language: Language;
  evalT: EvalTranslationKeys;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="inspector-run-select" className="text-[12px] font-sans text-muted-foreground cursor-pointer">
        {evalT.inspectorRunLabel}
      </label>
      <select
        id="inspector-run-select"
        value={currentRunId ?? ''}
        onChange={e => e.target.value && onSelectRun(e.target.value)}
        className="h-9 max-w-[24rem] border border-border bg-card px-3 rounded-lg text-[12.5px] font-sans focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
      >
        <option value="">{evalT.inspectorPickRun}</option>
        {history.map(r => (
          <option key={r.id} value={r.id}>{baselineLabel(r, language, evalT)}</option>
        ))}
      </select>
    </div>
  );
}

export function InspectorTab({
  result,
  history,
  currentRunId,
  onSelectRun,
  language,
  evalT,
}: {
  result: EvalRunResult | null;
  history: EvalRunSummary[];
  currentRunId?: string;
  onSelectRun: (id: string) => void;
  language: Language;
  evalT: EvalTranslationKeys;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = result?.cases ?? [];
    const q = query.trim().toLowerCase();
    return list.filter(c => {
      if (filter === 'pass' && !c.passed) return false;
      if (filter === 'fail' && c.passed) return false;
      if (q && !c.question.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [result, filter, query]);

  // No run loaded yet: prompt to pick one if any exist, else the run-eval hint.
  if (!result) {
    return (
      <div className="flex flex-col gap-4 max-w-295">
        {history.length > 0 && (
          <RunPicker history={history} currentRunId={currentRunId} onSelectRun={onSelectRun} language={language} evalT={evalT} />
        )}
        <div className="py-16 text-center">
          <p className="text-[14px] font-sans text-muted-foreground/60">
            {history.length > 0 ? evalT.inspectorPickRun : evalT.noResultsYet}
          </p>
        </div>
      </div>
    );
  }

  const selected = filtered.find(c => c.caseId === selectedId) ?? filtered[0] ?? null;

  const filterBtn = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className="cursor-pointer text-[12px] font-sans px-2.5 py-1 rounded-lg border transition-colors focus:outline-none"
      style={{
        borderColor: filter === f ? 'color-mix(in srgb, hsl(var(--primary)) 40%, transparent)' : 'hsl(var(--border))',
        color: filter === f ? GOOD : 'hsl(var(--muted-foreground))',
        background: filter === f ? 'color-mix(in srgb, hsl(var(--primary)) 8%, transparent)' : 'transparent',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 max-w-295">
      {history.length > 0 && (
        <RunPicker history={history} currentRunId={currentRunId} onSelectRun={onSelectRun} language={language} evalT={evalT} />
      )}
      <div className="grid grid-cols-1 md:grid-cols-[330px_1fr] gap-4 items-start">
      {/* list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-3 space-y-2.5 border-b border-border">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={evalT.inspectorSearchPlaceholder}
            className="w-full h-9 border border-input bg-background px-3 rounded-lg text-[12.5px] font-sans focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-1.5">
            {filterBtn('all', evalT.filterAll)}
            {filterBtn('pass', evalT.filterPass)}
            {filterBtn('fail', evalT.filterFail)}
          </div>
        </div>
        <div className="flex flex-col max-h-[64vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-[12px] font-sans text-muted-foreground italic py-4 text-center">{evalT.inspectorEmpty}</p>
          ) : (
            filtered.map((c, i) => {
              const active = c.caseId === selected?.caseId;
              const accent = c.passed ? GOOD : BAD;
              const score = c.faithfulness;
              return (
                <button
                  key={c.caseId}
                  type="button"
                  onClick={() => setSelectedId(c.caseId)}
                  className="cursor-pointer text-left flex items-center gap-2.5 px-3 py-2.5 border-t border-border first:border-t-0 transition-colors focus:outline-none hover:bg-muted/40"
                  style={{ borderLeft: `2px solid ${active ? accent : 'transparent'}`, background: active ? 'color-mix(in srgb, hsl(var(--primary)) 7%, transparent)' : 'transparent' }}
                >
                  <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums shrink-0">
                    #{String(i + 1).padStart(3, '0')}
                  </span>
                  <span className="flex-1 text-[13px] font-sans text-foreground line-clamp-1">{c.question}</span>
                  <span className="font-mono text-[11px] font-semibold tabular-nums shrink-0" style={{ color: score != null ? scoreColor(score) : accent }}>
                    {score != null ? score.toFixed(2) : c.passed ? '✓' : '✗'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* detail */}
      {selected ? (
        <QueryDetail c={selected} evalT={evalT} />
      ) : (
        <div className="py-16 text-center">
          <p className="text-[14px] font-sans text-muted-foreground/60">{evalT.inspectorSelectPrompt}</p>
        </div>
      )}
      </div>
    </div>
  );
}
