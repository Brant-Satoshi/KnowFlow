'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import { RetrievalFilterControl } from '@/components/chat/retrieval-filter';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type {
  FileListItem,
  KnowledgeBase,
  EvalRunResult,
  EvalRunSummary,
  EvalRunDetail,
  RetrievalFilter,
} from '@/lib/types';
import { listDatasetNames } from '@/lib/eval/dataset';
import type { DatasetValidationResult } from '@/lib/eval/validate';
import { httpClient, HttpError } from '@/lib/http/client';
import {
  EVAL_STYLES,
  ScanSkeleton,
  detailToResult,
  baselineLabel,
  GOLD,
} from './_components/shared';
import { EvalSidebar, EvalSidebarNav, type EvalTab } from './_components/eval-sidebar';
import { MobileNav } from '@/components/mobile-nav';
import { OverviewTab } from './_components/overview-tab';
import { CompareTab } from './_components/compare-tab';
import { InspectorTab } from './_components/inspector-tab';
import { DatasetTab } from './_components/dataset-tab';

const EVAL_TABS: EvalTab[] = ['overview', 'compare', 'inspector', 'dataset'];

function parseTab(value: string | null): EvalTab {
  return EVAL_TABS.includes(value as EvalTab) ? (value as EvalTab) : 'overview';
}

export default function EvalPage() {
  return (
    <Suspense fallback={null}>
      <EvalPageContent />
    </Suspense>
  );
}

function EvalPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { evalT, home, language } = useLanguage();
  const datasetNames = listDatasetNames();

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [selectedKbId, setSelectedKbId] = useState('');
  const [selectedDataset, setSelectedDataset] = useState(() => datasetNames[0] ?? '');
  const [useRerank, setUseRerank] = useState(true);
  const [evalFilter, setEvalFilter] = useState<RetrievalFilter>({});
  const [kbFiles, setKbFiles] = useState<FileListItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<EvalRunResult | null>(null);
  const [runError, setRunError] = useState('');

  const [history, setHistory] = useState<EvalRunSummary[]>([]);
  const [viewingHistorical, setViewingHistorical] = useState(false);
  const [baselineId, setBaselineId] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);

  const activeTab = parseTab(searchParams.get('tab'));
  const selectTab = useCallback(
    (tab: EvalTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`/eval?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const [datasetReport, setDatasetReport] = useState<DatasetValidationResult | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetError, setDatasetError] = useState('');

  useEffect(() => {
    httpClient
      .get<{ knowledgeBases: KnowledgeBase[] }>('/api/knowledge-bases')
      .then(data => setKnowledgeBases(data.knowledgeBases))
      .catch(() => {})
      .finally(() => setLoadingKbs(false));
  }, []);

  // Lint the golden set lazily — only when the Dataset tab is active, refetch on dataset change.
  useEffect(() => {
    if (activeTab !== 'dataset' || !selectedDataset) return;
    let cancelled = false;
    setDatasetLoading(true);
    setDatasetError('');
    setDatasetReport(null);
    httpClient
      .get<DatasetValidationResult>(`/api/eval/validate?dataset=${encodeURIComponent(selectedDataset)}`)
      .then(data => {
        if (!cancelled) setDatasetReport(data);
      })
      .catch(() => {
        if (!cancelled) setDatasetError(evalT.datasetErrorLoading);
      })
      .finally(() => {
        if (!cancelled) setDatasetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedDataset, evalT]);

  const loadHistory = useCallback(async (kbId: string) => {
    if (!kbId) {
      setHistory([]);
      return;
    }
    try {
      const data = await httpClient.get<{ runs: EvalRunSummary[] }>(`/api/eval/runs?knowledgeBaseId=${kbId}`);
      setHistory(data.runs);
    } catch {
      setHistory([]);
    }
  }, []);

  // Reset the displayed run + baseline whenever the knowledge base changes.
  useEffect(() => {
    setResult(null);
    setViewingHistorical(false);
    setBaselineId('');
    setRunError('');
    loadHistory(selectedKbId);
  }, [selectedKbId, loadHistory]);

  // The retrieval filter is KB-specific: reset it and refetch the file list on KB change.
  useEffect(() => {
    setEvalFilter({});
    if (!selectedKbId) {
      setKbFiles([]);
      return;
    }
    let cancelled = false;
    httpClient
      .get<{ files: FileListItem[] }>(`/api/files?knowledgeBaseId=${selectedKbId}`)
      .then(data => {
        if (!cancelled) setKbFiles(data.files);
      })
      .catch(() => {
        if (!cancelled) setKbFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKbId]);

  const loadDetail = useCallback(
    async (runId: string) => {
      setLoadingDetail(true);
      setRunError('');
      try {
        const data = await httpClient.get<{ run: EvalRunDetail }>(`/api/eval/runs/${runId}`);
        setResult(detailToResult(data.run));
        setViewingHistorical(true);
      } catch {
        setRunError(evalT.historyErrorLoading);
      } finally {
        setLoadingDetail(false);
      }
    },
    [evalT],
  );

  async function handleRunEval(): Promise<void> {
    if (!selectedKbId || !selectedDataset || isRunning) return;
    setIsRunning(true);
    setRunError('');
    setResult(null);
    setViewingHistorical(false);
    try {
      const body: Record<string, unknown> = {
        knowledgeBaseId: selectedKbId,
        mode: 'curated',
        datasetName: selectedDataset,
        useRerank,
      };
      if (evalFilter.fileIds?.length || evalFilter.fileTypes?.length || evalFilter.titleQuery) {
        body.filter = evalFilter;
      }
      const data = await httpClient.post<EvalRunResult>('/api/eval/run', body);
      setResult(data);
      selectTab('overview');
      loadHistory(selectedKbId);
    } catch (err) {
      const code = err instanceof HttpError ? err.message : undefined;
      setRunError(code === 'eval_no_chunks' ? evalT.errorNoChunks : evalT.errorRunning);
    } finally {
      setIsRunning(false);
    }
  }

  const canRun = Boolean(selectedKbId && selectedDataset) && !isRunning;
  const baseline = baselineId ? history.find(r => r.id === baselineId) ?? null : null;
  const formatKnowledgeBaseOption = (kb: KnowledgeBase) =>
    `${kb.name} · ${evalT.chunkCountLabel.replace('{count}', String(kb.chunkCount ?? 0))}`;
  const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId) ?? null;
  const kbLabel = selectedKb ? formatKnowledgeBaseOption(selectedKb) : null;

  const titles: Record<EvalTab, string> = {
    overview: evalT.tabOverview,
    compare: evalT.tabCompare,
    inspector: evalT.tabInspector,
    dataset: evalT.tabDataset,
  };

  return (
    <>
      <style>{EVAL_STYLES}</style>
      <div className="min-h-screen md:grid md:grid-cols-[212px_1fr] bg-background text-foreground">
        {/* ── Mobile top bar (< md) ── */}
        <MobileNav appName={home.title} menuLabel={evalT.openMenu} navTitle={evalT.navSectionEvaluate}>
          {(close) => (
            <EvalSidebarNav
              activeTab={activeTab}
              onSelect={(tab) => {
                selectTab(tab);
                close();
              }}
              kbLabel={selectedKb ? selectedKb.name : null}
              evalT={evalT}
            />
          )}
        </MobileNav>

        <EvalSidebar
          activeTab={activeTab}
          onSelect={selectTab}
          appName={home.title}
          kbLabel={selectedKb ? selectedKb.name : null}
          evalT={evalT}
        />

        <main className="min-w-0 flex flex-col">
          {/* ── Topbar ── */}
          <div className="z-20 border-b border-border bg-background/90 backdrop-blur px-4 py-2.5 md:sticky md:top-0 md:px-5">
            <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center md:gap-3">
              <div className="flex items-baseline gap-3 md:mr-auto">
                <span className="text-[15px] font-sans font-semibold">{titles[activeTab]}</span>
                {kbLabel && <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[40vw]">{kbLabel}</span>}
              </div>

              {!loadingKbs && knowledgeBases.length > 0 && (
                <select
                  value={selectedKbId}
                  onChange={e => setSelectedKbId(e.target.value)}
                  aria-label={evalT.selectKnowledgeBase}
                  className="eval-select h-9 w-full border border-border bg-card pl-3 pr-9 rounded-lg text-[12.5px] font-sans focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer md:w-auto md:max-w-[16rem]"
                >
                  <option value="">{evalT.selectPlaceholder}</option>
                  {knowledgeBases.map(kb => (
                    <option key={kb.id} value={kb.id}>{formatKnowledgeBaseOption(kb)}</option>
                  ))}
                </select>
              )}

              <select
                value={selectedDataset}
                onChange={e => setSelectedDataset(e.target.value)}
                disabled={isRunning}
                aria-label={evalT.datasetLabel}
                className="eval-select h-9 w-full border border-border bg-card pl-3 pr-9 rounded-lg text-[12.5px] font-sans focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer disabled:cursor-not-allowed md:w-auto"
              >
                {datasetNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>

              <RetrievalFilterControl
                files={kbFiles.filter(f => f.status === 'indexed')}
                value={evalFilter}
                onChange={setEvalFilter}
                disabled={isRunning || !selectedKbId}
                labels={{
                  button: evalT.filterButtonLabel,
                  aria: evalT.filterAriaLabel,
                  filesLabel: evalT.filterFilesLabel,
                  noFiles: evalT.filterNoFiles,
                  typesLabel: evalT.filterTypesLabel,
                  typePdf: evalT.filterTypePdf,
                  typeMarkdown: evalT.filterTypeMarkdown,
                  typeWord: evalT.filterTypeWord,
                  typeText: evalT.filterTypeText,
                  titleLabel: evalT.filterTitleLabel,
                  titlePlaceholder: evalT.filterTitlePlaceholder,
                  clear: evalT.filterClear,
                }}
                triggerClassName="h-9 w-full cursor-pointer justify-start gap-1.5 rounded-lg border-border bg-card text-[12.5px] font-sans shadow-none md:w-auto md:justify-center"
              />

              <label htmlFor="rerank-toggle" className="h-9 w-full md:w-auto flex items-center justify-between md:justify-start gap-2.5 border border-border bg-card px-3 rounded-lg cursor-pointer select-none">
                <span className="text-[12.5px] font-sans text-foreground">{evalT.rerankToggleLabel}</span>
                <Switch id="rerank-toggle" checked={useRerank} onCheckedChange={setUseRerank} disabled={isRunning} />
              </label>

              <button
                onClick={handleRunEval}
                disabled={!canRun}
                className="h-9 w-full md:w-auto cursor-pointer px-4 rounded-lg text-[12.5px] font-sans font-semibold disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus:outline-none flex items-center justify-center gap-2"
                style={{
                  background: canRun ? `linear-gradient(135deg, ${GOLD}, color-mix(in srgb, ${GOLD} 80%, black))` : 'hsl(var(--muted))',
                  color: canRun ? '#fff' : 'hsl(var(--muted-foreground))',
                  boxShadow: canRun ? `0 2px 10px color-mix(in srgb, ${GOLD} 30%, transparent)` : 'none',
                }}
              >
                {isRunning ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" style={{ animation: 'eval-dot-pulse 0.9s ease-in-out infinite' }} />
                    {evalT.running}
                  </>
                ) : (
                  `+ ${evalT.runEval}`
                )}
              </button>
            </div>

            {/* Baseline picker — only affects Overview deltas */}
            {activeTab === 'overview' && history.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 md:justify-end">
                <label htmlFor="baseline-select" className="text-[12px] font-sans text-muted-foreground cursor-pointer">
                  {evalT.baselineLabel}
                </label>
                <select
                  id="baseline-select"
                  value={baselineId}
                  onChange={e => setBaselineId(e.target.value)}
                  className="h-8 min-w-0 flex-1 md:flex-none md:max-w-[20rem] border border-input bg-card px-2.5 rounded-lg text-[12px] font-sans focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                >
                  <option value="">{evalT.baselineNone}</option>
                  {history.map(r => (
                    <option key={r.id} value={r.id}>{baselineLabel(r, language, evalT)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── Content ── */}
          <div className="p-5 space-y-4">
            {runError && <p className="text-[14px] font-sans" style={{ color: 'var(--card-accent-2)' }}>{runError}</p>}

            {viewingHistorical && result && (
              <p className="text-[12px] font-sans text-muted-foreground flex items-center gap-2">
                <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
                {evalT.viewingSavedRun}
              </p>
            )}

            {isRunning || loadingDetail ? (
              <ScanSkeleton />
            ) : activeTab === 'overview' ? (
              <OverviewTab
                result={result}
                history={history}
                baseline={baseline}
                evalT={evalT}
                language={language}
                onSelectRun={loadDetail}
              />
            ) : activeTab === 'compare' ? (
              <CompareTab history={history} evalT={evalT} language={language} />
            ) : activeTab === 'dataset' ? (
              <DatasetTab
                report={datasetReport}
                loading={datasetLoading}
                error={datasetError}
                evalT={evalT}
              />
            ) : (
              <InspectorTab
                result={result}
                history={history}
                currentRunId={result?.runId}
                onSelectRun={loadDetail}
                language={language}
                evalT={evalT}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
