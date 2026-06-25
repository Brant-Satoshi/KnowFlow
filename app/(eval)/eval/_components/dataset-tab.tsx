'use client';

import { useMemo, useState } from 'react';
import type { EvalTranslationKeys } from '@/lib/i18n/translations';
import type {
  DatasetValidationResult,
  DatasetCaseReport,
  DatasetIssue,
  DatasetIssueCode,
} from '@/lib/eval/validate';
import { GOOD, BAD, GOLD, ScanSkeleton } from './shared';

type Filter = 'all' | 'errors' | 'warnings' | 'ok';

const ISSUE_MSG_KEY: Record<DatasetIssueCode, keyof EvalTranslationKeys> = {
  missing_id: 'issueMissingId',
  duplicate_id: 'issueDuplicateId',
  missing_question: 'issueMissingQuestion',
  invalid_category: 'issueInvalidCategory',
  invalid_difficulty: 'issueInvalidDifficulty',
  target_file_missing: 'issueTargetFileMissing',
  substring_not_in_source: 'issueSubstringNotInSource',
  keyword_not_in_source: 'issueKeywordNotInSource',
  keyword_not_in_expected_answer: 'issueKeywordNotInExpectedAnswer',
  empty_keywords: 'issueEmptyKeywords',
  no_targets: 'issueNoTargets',
  out_of_scope_has_targets: 'issueOutOfScopeHasTargets',
};

function formatIssueMessage(evalT: EvalTranslationKeys, issue: DatasetIssue): string {
  return evalT[ISSUE_MSG_KEY[issue.code]].replace('{value}', issue.value ?? '');
}

/** Green = clean, gold = warnings only, terracotta = has errors. */
function caseAccent(c: DatasetCaseReport): string {
  if (c.errorCount > 0) return BAD;
  if (c.warningCount > 0) return GOLD;
  return GOOD;
}

function StatusPill({ c }: { c: DatasetCaseReport }) {
  const accent = caseAccent(c);
  const label =
    c.errorCount > 0
      ? String(c.errorCount)
      : c.warningCount > 0
        ? String(c.warningCount)
        : '✓';
  return (
    <span className="font-mono text-[11px] font-semibold tabular-nums shrink-0" style={{ color: accent }}>
      {label}
    </span>
  );
}

function IssueRow({ issue, evalT }: { issue: DatasetIssue; evalT: EvalTranslationKeys }) {
  const isError = issue.severity === 'error';
  const accent = isError ? BAD : GOLD;
  return (
    <div className="flex gap-3 p-3 rounded-[10px] border" style={{ background: `color-mix(in srgb, ${accent} 7%, transparent)`, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }}>
      <span
        className="text-[10px] font-mono font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-md h-fit shrink-0"
        style={{ color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}
      >
        {isError ? evalT.datasetSeverityError : evalT.datasetSeverityWarning}
      </span>
      <p className="text-[12.5px] font-sans text-foreground/85 leading-relaxed">
        {formatIssueMessage(evalT, issue)}
      </p>
    </div>
  );
}

function CaseDetail({ c, evalT }: { c: DatasetCaseReport; evalT: EvalTranslationKeys }) {
  const accent = caseAccent(c);
  // Errors first, then warnings.
  const issues = [...c.issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card border border-border rounded-xl p-4.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] uppercase text-muted-foreground mb-1.5">
              {c.caseId} · {c.category} · {c.difficulty}
            </div>
            <div className="text-[19px] font-sans font-semibold leading-snug tracking-[-0.01em]">{c.question}</div>
          </div>
          <span className="w-2.25 h-2.25 rounded-full mt-2 shrink-0" style={{ background: accent }} />
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-4.5 text-[13px] font-sans" style={{ color: GOOD }}>
          ✓ {evalT.datasetCaseClean}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {issues.map((issue, i) => (
            <IssueRow key={`${issue.code}-${issue.value ?? i}`} issue={issue} evalT={evalT} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DatasetTab({
  report,
  loading,
  error,
  evalT,
}: {
  report: DatasetValidationResult | null;
  loading: boolean;
  error: string;
  evalT: EvalTranslationKeys;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = report?.cases ?? [];
    return list.filter(c => {
      if (filter === 'errors') return c.errorCount > 0;
      if (filter === 'warnings') return c.warningCount > 0;
      if (filter === 'ok') return c.errorCount === 0 && c.warningCount === 0;
      return true;
    });
  }, [report, filter]);

  if (loading) return <ScanSkeleton />;
  if (error) {
    return <p className="text-[14px] font-sans" style={{ color: BAD }}>{error}</p>;
  }
  if (!report) return null;

  const selected = filtered.find(c => c.caseId === selectedId) ?? filtered[0] ?? null;
  const allClean = report.errorCount === 0 && report.warningCount === 0;

  const summaryText = evalT.datasetSummary
    .replace('{cases}', String(report.totalCases))
    .replace('{errors}', String(report.errorCount))
    .replace('{warnings}', String(report.warningCount));

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
      {/* summary band */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span
          className="text-[13px] font-sans font-semibold"
          style={{ color: allClean ? GOOD : report.errorCount > 0 ? BAD : GOLD }}
        >
          {summaryText}
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">{evalT.datasetFilesLabel}</span>
          {report.files.map(f => (
            <span key={f.name} className="flex items-center gap-1.5 text-[12px] font-mono tabular-nums" style={{ color: f.exists ? GOOD : BAD }}>
              {f.exists ? '✓' : '✗'} {f.name}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[330px_1fr] gap-4 items-start">
        {/* list */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-3 border-b border-border">
            <div className="flex flex-wrap gap-1.5">
              {filterBtn('all', evalT.filterAll)}
              {filterBtn('errors', evalT.datasetFilterErrors)}
              {filterBtn('warnings', evalT.datasetFilterWarnings)}
              {filterBtn('ok', evalT.datasetFilterOk)}
            </div>
          </div>
          <div className="flex flex-col max-h-[64vh] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-[12px] font-sans text-muted-foreground italic py-4 text-center">{evalT.inspectorEmpty}</p>
            ) : (
              filtered.map((c, i) => {
                const active = c.caseId === selected?.caseId;
                const accent = caseAccent(c);
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
                    <StatusPill c={c} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* detail */}
        {selected ? (
          <CaseDetail c={selected} evalT={evalT} />
        ) : (
          <div className="py-16 text-center">
            <p className="text-[14px] font-sans" style={{ color: allClean ? GOOD : 'hsl(var(--muted-foreground) / 0.6)' }}>
              {allClean ? `✓ ${evalT.datasetNoIssues}` : evalT.inspectorSelectPrompt}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
