'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { httpClient, HttpError } from '@/lib/http/client';
import {
  EVAL_CASE_CATEGORIES,
  EVAL_CASE_DIFFICULTIES,
  MAX_GOLDSET_CASES,
} from '@/lib/validation';
import type { EvalTranslationKeys } from '@/lib/i18n/translations';
import type {
  EvalCaseCategory,
  EvalCaseDifficulty,
  EvalCaseRecord,
  EvalDatasetDetail,
  EvalDatasetSummary,
  GoldsetValidationReport,
  RetrievalFilter,
} from '@/lib/types';
import { BAD, GOOD, GoldsetIssuesPanel, ScanSkeleton } from './shared';

/* ───────────────────── API plumbing ───────────────────── */

/** Every successful dataset write returns the fresh summary + cases. */
interface WriteResponse {
  dataset: EvalDatasetSummary;
  cases: EvalCaseRecord[];
}

/**
 * Maps API failures onto user-facing text. `dataset_changed` additionally
 * signals the caller to refetch (the server payload carries the current hash,
 * but a full detail reload keeps cases in sync too).
 */
function apiErrorMessage(err: unknown, evalT: EvalTranslationKeys): string {
  if (!(err instanceof HttpError)) return evalT.errOperationFailed;
  switch (err.message) {
    case 'dataset_changed':
      return evalT.errDatasetChanged;
    case 'dataset_name_conflict':
      return evalT.errNameConflict;
    case 'duplicate_case_keys': {
      const data = err.data as { duplicateCaseKeys?: string[] } | undefined;
      return evalT.errDuplicateKeys.replace('{keys}', (data?.duplicateCaseKeys ?? []).join(', '));
    }
    case 'goldset_limit_exceeded': {
      const data = err.data as
        | { limit?: number; existingCount?: number; incomingCount?: number }
        | undefined;
      return evalT.errLimitExceeded
        .replace('{existing}', String(data?.existingCount ?? '?'))
        .replace('{incoming}', String(data?.incomingCount ?? '?'))
        .replace('{limit}', String(data?.limit ?? MAX_GOLDSET_CASES));
    }
    default:
      return evalT.errOperationFailed;
  }
}

function isDatasetChanged(err: unknown): boolean {
  return err instanceof HttpError && err.message === 'dataset_changed';
}

/* ───────────────────── enum display labels ───────────────────── */

const CATEGORY_LABEL_KEY: Record<EvalCaseCategory, keyof EvalTranslationKeys> = {
  single_fact: 'catSingleFact',
  numeric_fact: 'catNumericFact',
  list_extraction: 'catListExtraction',
  synthesis: 'catSynthesis',
  disambiguation: 'catDisambiguation',
  out_of_scope: 'catOutOfScope',
};

const DIFFICULTY_LABEL_KEY: Record<EvalCaseDifficulty, keyof EvalTranslationKeys> = {
  easy: 'diffEasy',
  medium: 'diffMedium',
  hard: 'diffHard',
};

/** Translated label; falls back to the raw value for out-of-enum legacy rows. */
function categoryLabel(evalT: EvalTranslationKeys, value: EvalCaseCategory): string {
  const key = CATEGORY_LABEL_KEY[value];
  return key ? evalT[key] : value;
}

function difficultyLabel(evalT: EvalTranslationKeys, value: EvalCaseDifficulty): string {
  const key = DIFFICULTY_LABEL_KEY[value];
  return key ? evalT[key] : value;
}

/* ───────────────────── case form ───────────────────── */

interface CaseFormValues {
  caseKey: string;
  question: string;
  category: string;
  difficulty: string;
  keywords: string;
  targetFiles: string;
  substrings: string;
  expectedAnswer: string;
  notes: string;
}

const EMPTY_FORM: CaseFormValues = {
  caseKey: '',
  question: '',
  category: EVAL_CASE_CATEGORIES[0],
  difficulty: EVAL_CASE_DIFFICULTIES[0],
  keywords: '',
  targetFiles: '',
  substrings: '',
  expectedAnswer: '',
  notes: '',
};

function recordToForm(record: EvalCaseRecord): CaseFormValues {
  return {
    caseKey: record.caseKey,
    question: record.question,
    category: record.category,
    difficulty: record.difficulty,
    keywords: record.expectedKeywords.join(', '),
    targetFiles: record.targetFileNames.join(', '),
    substrings: record.targetChunkSubstrings.join('\n'),
    expectedAnswer: record.expectedAnswer ?? '',
    notes: record.notes ?? '',
  };
}

function splitCommaList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Form → EvalCase JSON body (`id` is the business case key). */
function formToCaseInput(form: CaseFormValues): Record<string, unknown> {
  return {
    id: form.caseKey.trim(),
    question: form.question.trim(),
    category: form.category,
    difficulty: form.difficulty,
    expectedKeywords: splitCommaList(form.keywords),
    targetFileNames: splitCommaList(form.targetFiles),
    targetChunkSubstrings: form.substrings.split('\n').filter((s) => s.trim().length > 0),
    expectedAnswer: form.expectedAnswer.trim() || undefined,
    notes: form.notes.trim() || undefined,
  };
}

function FieldLabel({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-sans text-muted-foreground cursor-pointer">
      {children}
    </label>
  );
}

function CaseFormDialog({
  open,
  onOpenChange,
  initial,
  evalT,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create; a record = edit. */
  initial: EvalCaseRecord | null;
  evalT: EvalTranslationKeys;
  onSubmit: (input: Record<string, unknown>) => Promise<string | null>;
}) {
  // Mounted only while open (see the tab's render), so initializers reset the form.
  const [form, setForm] = useState<CaseFormValues>(() =>
    initial ? recordToForm(initial) : EMPTY_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const set = (key: keyof CaseFormValues) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    setFormError('');
    const message = await onSubmit(formToCaseInput(form));
    setBusy(false);
    if (message) {
      setFormError(message);
    } else {
      onOpenChange(false);
    }
  }

  const canSubmit = form.caseKey.trim().length > 0 && form.question.trim().length > 0 && !busy;
  const selectClass =
    'h-9 w-full border border-input bg-card px-2.5 rounded-lg text-[12.5px] font-sans focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer';

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? evalT.caseFormTitleEdit : evalT.caseFormTitleNew}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="case-key">{evalT.caseKeyLabel}</FieldLabel>
              <Input id="case-key" value={form.caseKey} onChange={(e) => set('caseKey')(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="case-category">{evalT.caseCategoryLabel}</FieldLabel>
                <select
                  id="case-category"
                  value={form.category}
                  onChange={(e) => set('category')(e.target.value)}
                  className={selectClass}
                >
                  {EVAL_CASE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{categoryLabel(evalT, c)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="case-difficulty">{evalT.caseDifficultyLabel}</FieldLabel>
                <select
                  id="case-difficulty"
                  value={form.difficulty}
                  onChange={(e) => set('difficulty')(e.target.value)}
                  className={selectClass}
                >
                  {EVAL_CASE_DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>{difficultyLabel(evalT, d)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="case-question">{evalT.caseQuestionLabel}</FieldLabel>
            <Textarea id="case-question" rows={2} value={form.question} onChange={(e) => set('question')(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="case-keywords">{evalT.caseKeywordsLabel}</FieldLabel>
            <Input id="case-keywords" value={form.keywords} onChange={(e) => set('keywords')(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="case-files">{evalT.caseTargetFilesLabel}</FieldLabel>
            <Input id="case-files" value={form.targetFiles} onChange={(e) => set('targetFiles')(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="case-substrings">{evalT.caseSubstringsLabel}</FieldLabel>
            <Textarea id="case-substrings" rows={3} value={form.substrings} onChange={(e) => set('substrings')(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="case-expected">{evalT.caseExpectedAnswerLabel}</FieldLabel>
            <Textarea id="case-expected" rows={2} value={form.expectedAnswer} onChange={(e) => set('expectedAnswer')(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="case-notes">{evalT.caseNotesLabel}</FieldLabel>
            <Textarea id="case-notes" rows={2} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
          </div>
          {formError && <p className="text-[12.5px] font-sans" style={{ color: BAD }}>{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-lg cursor-pointer" disabled={busy} onClick={() => onOpenChange(false)}>
            {evalT.dsCancel}
          </Button>
          <Button className="rounded-lg cursor-pointer" disabled={!canSubmit} onClick={handleSubmit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {evalT.dsSaveSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────── dataset meta form (create / edit) ───────────────────── */

function DatasetMetaDialog({
  open,
  onOpenChange,
  mode,
  initialName,
  initialDescription,
  evalT,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialName: string;
  initialDescription: string;
  evalT: EvalTranslationKeys;
  onSubmit: (name: string, description: string) => Promise<string | null>;
}) {
  // Mounted only while open, so initializers pick up the current values.
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    setFormError('');
    const message = await onSubmit(name.trim(), description.trim());
    setBusy(false);
    if (message) {
      setFormError(message);
    } else {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? evalT.dsCreateTitle : evalT.dsEditTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="ds-name">{evalT.dsNameLabel}</FieldLabel>
            <Input id="ds-name" value={name} placeholder={evalT.dsNamePlaceholder} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="ds-description">{evalT.dsDescriptionLabel}</FieldLabel>
            <Textarea
              id="ds-description"
              rows={2}
              value={description}
              placeholder={evalT.dsDescriptionPlaceholder}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {formError && <p className="text-[12.5px] font-sans" style={{ color: BAD }}>{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-lg cursor-pointer" disabled={busy} onClick={() => onOpenChange(false)}>
            {evalT.dsCancel}
          </Button>
          <Button
            className="rounded-lg cursor-pointer"
            disabled={busy || name.trim().length === 0}
            onClick={handleSubmit}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'create' ? evalT.dsCreateSubmit : evalT.dsSaveSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────── JSON import ───────────────────── */

function ImportDialog({
  open,
  onOpenChange,
  evalT,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalT: EvalTranslationKeys;
  onSubmit: (cases: unknown[]) => Promise<string | null>;
}) {
  // Mounted only while open, so the textarea starts empty on every open.
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit() {
    if (busy) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setFormError(evalT.importInvalidJson);
      return;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setFormError(evalT.importInvalidJson);
      return;
    }
    setBusy(true);
    setFormError('');
    const message = await onSubmit(parsed);
    setBusy(false);
    if (message) {
      setFormError(message);
    } else {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{evalT.importTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] font-sans text-muted-foreground leading-relaxed">
          {evalT.importHint.replace('{limit}', String(MAX_GOLDSET_CASES))}
        </p>
        <Textarea
          aria-label={evalT.importTitle}
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-[12px]"
          placeholder={evalT.importPlaceholder}
        />
        {formError && <p className="text-[12.5px] font-sans" style={{ color: BAD }}>{formError}</p>}
        <DialogFooter>
          <Button variant="outline" className="rounded-lg cursor-pointer" disabled={busy} onClick={() => onOpenChange(false)}>
            {evalT.dsCancel}
          </Button>
          <Button className="rounded-lg cursor-pointer" disabled={busy || text.trim().length === 0} onClick={handleSubmit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {evalT.importSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────── the tab ───────────────────── */

export function DatasetTab({
  datasets,
  loadingDatasets,
  selectedDatasetId,
  onSelectDataset,
  onDatasetsChanged,
  knowledgeBaseId,
  filter,
  evalT,
}: {
  datasets: EvalDatasetSummary[];
  loadingDatasets: boolean;
  selectedDatasetId: string;
  onSelectDataset: (id: string) => void;
  /** Page-level refetch of the summaries list (names, counts, hashes). */
  onDatasetsChanged: () => Promise<void>;
  knowledgeBaseId: string;
  filter?: RetrievalFilter;
  evalT: EvalTranslationKeys;
}) {
  const [detail, setDetail] = useState<EvalDatasetDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tabError, setTabError] = useState('');

  const [report, setReport] = useState<GoldsetValidationReport | null>(null);
  const [validating, setValidating] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [caseFormOpen, setCaseFormOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<EvalCaseRecord | null>(null);
  const [deletingCase, setDeletingCase] = useState<EvalCaseRecord | null>(null);
  const [deleteDatasetOpen, setDeleteDatasetOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadDetail = useCallback(
    async (datasetId: string) => {
      setLoadingDetail(true);
      setTabError('');
      try {
        const data = await httpClient.get<{ dataset: EvalDatasetDetail }>(
          `/api/eval/datasets/${datasetId}`,
        );
        setDetail(data.dataset);
      } catch {
        setDetail(null);
        setTabError(evalT.datasetErrorLoading);
      } finally {
        setLoadingDetail(false);
      }
    },
    [evalT],
  );

  useEffect(() => {
    setReport(null);
    if (!selectedDatasetId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedDatasetId);
  }, [selectedDatasetId, loadDetail]);

  // The compatibility half of a report is KB/filter-specific.
  useEffect(() => {
    setReport(null);
  }, [knowledgeBaseId, filter]);

  /** Runs a write; on success updates local detail + page list, on failure returns the message. */
  const applyWrite = useCallback(
    async (write: () => Promise<WriteResponse>): Promise<string | null> => {
      try {
        const data = await write();
        setDetail({ ...data.dataset, cases: data.cases });
        setReport(null);
        onDatasetsChanged();
        return null;
      } catch (err) {
        if (isDatasetChanged(err) && selectedDatasetId) {
          // Rebase on the winning writer's version so the retry uses a fresh revision.
          loadDetail(selectedDatasetId);
          onDatasetsChanged();
        }
        return apiErrorMessage(err, evalT);
      }
    },
    [evalT, loadDetail, onDatasetsChanged, selectedDatasetId],
  );

  async function handleCreate(name: string, description: string): Promise<string | null> {
    try {
      const data = await httpClient.post<WriteResponse>('/api/eval/datasets', {
        name,
        ...(description ? { description } : {}),
      });
      // Refresh the list before selecting: the page's keep-valid-selection
      // effect would otherwise reset a selection it can't find yet.
      await onDatasetsChanged();
      onSelectDataset(data.dataset.id);
      return null;
    } catch (err) {
      return apiErrorMessage(err, evalT);
    }
  }

  async function handleEditMeta(name: string, description: string): Promise<string | null> {
    if (!detail) return evalT.errOperationFailed;
    return applyWrite(() =>
      httpClient.patch<WriteResponse>(`/api/eval/datasets/${detail.id}`, {
        expectedRevision: detail.revision,
        name,
        description,
      }),
    );
  }

  async function handleDeleteDataset(): Promise<void> {
    if (!detail) return;
    setDeleteBusy(true);
    try {
      await httpClient.deleteWithBody(`/api/eval/datasets/${detail.id}`, {
        expectedRevision: detail.revision,
      });
      setDeleteDatasetOpen(false);
      setDetail(null);
      onSelectDataset('');
      onDatasetsChanged();
    } catch (err) {
      setDeleteDatasetOpen(false);
      if (isDatasetChanged(err)) loadDetail(detail.id);
      setTabError(apiErrorMessage(err, evalT));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleCaseSubmit(input: Record<string, unknown>): Promise<string | null> {
    if (!detail) return evalT.errOperationFailed;
    if (editingCase) {
      return applyWrite(() =>
        httpClient.patch<WriteResponse>(
          `/api/eval/datasets/${detail.id}/cases/${editingCase.id}`,
          { expectedRevision: detail.revision, case: input },
        ),
      );
    }
    return applyWrite(() =>
      httpClient.post<WriteResponse>(`/api/eval/datasets/${detail.id}/cases`, {
        expectedRevision: detail.revision,
        cases: input,
      }),
    );
  }

  async function handleImport(cases: unknown[]): Promise<string | null> {
    if (!detail) return evalT.errOperationFailed;
    return applyWrite(() =>
      httpClient.post<WriteResponse>(`/api/eval/datasets/${detail.id}/cases`, {
        expectedRevision: detail.revision,
        cases,
      }),
    );
  }

  async function handleDeleteCase(): Promise<void> {
    if (!detail || !deletingCase) return;
    setDeleteBusy(true);
    const message = await applyWrite(() =>
      httpClient.deleteWithBody<WriteResponse>(
        `/api/eval/datasets/${detail.id}/cases/${deletingCase.id}`,
        { expectedRevision: detail.revision },
      ),
    );
    setDeleteBusy(false);
    setDeletingCase(null);
    if (message) setTabError(message);
  }

  async function handleValidate(): Promise<void> {
    if (!detail || !knowledgeBaseId || validating) return;
    setValidating(true);
    setTabError('');
    try {
      const data = await httpClient.post<GoldsetValidationReport>('/api/eval/validate', {
        datasetId: detail.id,
        knowledgeBaseId,
        ...(filter ? { filter } : {}),
      });
      setReport(data);
    } catch (err) {
      setReport(null);
      setTabError(apiErrorMessage(err, evalT));
    } finally {
      setValidating(false);
    }
  }

  if (loadingDatasets) return <ScanSkeleton />;

  const selected = datasets.find((d) => d.id === selectedDatasetId) ?? null;

  return (
    <div className="flex flex-col gap-4 max-w-295">
      {/* dataset picker strip */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 mr-auto">
          {datasets.length === 0 ? (
            <p className="text-[13px] font-sans text-muted-foreground px-1 py-1.5">{evalT.dsNoDatasets}</p>
          ) : (
            datasets.map((d) => {
              const active = d.id === selectedDatasetId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onSelectDataset(d.id)}
                  className="cursor-pointer flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12.5px] font-sans transition-colors focus:outline-none"
                  style={{
                    borderColor: active
                      ? 'color-mix(in srgb, hsl(var(--primary)) 45%, transparent)'
                      : 'hsl(var(--border))',
                    background: active
                      ? 'color-mix(in srgb, hsl(var(--primary)) 8%, transparent)'
                      : 'transparent',
                    color: active ? GOOD : 'hsl(var(--foreground))',
                  }}
                >
                  <span className="font-medium">{d.name}</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {d.caseCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <Button size="sm" className="rounded-lg cursor-pointer" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {evalT.dsNewButton}
        </Button>
      </div>

      {tabError && <p className="text-[13px] font-sans" style={{ color: BAD }}>{tabError}</p>}

      {!selected ? (
        <div className="py-14 text-center">
          <p className="text-[14px] font-sans text-muted-foreground/60">
            {datasets.length === 0 ? evalT.dsNoDatasets : evalT.dsSelectPrompt}
          </p>
        </div>
      ) : loadingDetail || !detail ? (
        <ScanSkeleton />
      ) : (
        <>
          {/* selected dataset header */}
          <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 mr-auto">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[16px] font-sans font-semibold">{detail.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {evalT.dsCapNote
                    .replace('{count}', String(detail.caseCount))
                    .replace('{limit}', String(MAX_GOLDSET_CASES))}
                </span>
                <span className="font-mono text-[10.5px] text-muted-foreground/70" title={detail.datasetHash}>
                  {detail.datasetHash.slice(0, 10)}
                </span>
              </div>
              {detail.description && (
                <p className="text-[12.5px] font-sans text-muted-foreground mt-1">{detail.description}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="rounded-lg cursor-pointer" onClick={() => { setEditingCase(null); setCaseFormOpen(true); }}>
                <Plus className="h-4 w-4" />
                {evalT.dsAddCaseButton}
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg cursor-pointer" onClick={() => setImportOpen(true)}>
                {evalT.dsImportButton}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg cursor-pointer"
                disabled={!knowledgeBaseId || validating}
                title={knowledgeBaseId ? undefined : evalT.dsValidateNeedsKb}
                onClick={handleValidate}
              >
                {validating && <Loader2 className="h-4 w-4 animate-spin" />}
                {evalT.dsValidateButton}
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg cursor-pointer" onClick={() => setEditMetaOpen(true)}>
                {evalT.dsEditMetaButton}
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg cursor-pointer text-destructive hover:text-destructive" onClick={() => setDeleteDatasetOpen(true)}>
                <Trash2 className="h-4 w-4" />
                {evalT.dsDeleteButton}
              </Button>
            </div>
          </div>

          {!knowledgeBaseId && (
            <p className="text-[12px] font-sans text-muted-foreground">{evalT.dsValidateNeedsKb}</p>
          )}

          {/* validation report */}
          {report && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] font-sans font-semibold" style={{ color: report.ok ? GOOD : BAD }}>
                {report.ok ? `✓ ${evalT.validateOk}` : evalT.validateBlocked}
              </p>
              <GoldsetIssuesPanel structural={report.structural} compatibility={report.compatibility} evalT={evalT} />
            </div>
          )}

          {/* case list */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {detail.cases.length === 0 ? (
              <p className="text-[13px] font-sans text-muted-foreground/70 italic py-8 text-center">
                {evalT.caseListEmpty}
              </p>
            ) : (
              detail.cases.map((c, i) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-t border-border first:border-t-0"
                >
                  <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums shrink-0">
                    #{String(i + 1).padStart(3, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-muted-foreground">{c.caseKey}</span>
                      <span className="text-[10px] font-sans px-1.5 py-0.5 rounded-md border border-border text-muted-foreground">
                        {categoryLabel(evalT, c.category)}
                      </span>
                      <span className="text-[10px] font-sans px-1.5 py-0.5 rounded-md border border-border text-muted-foreground">
                        {difficultyLabel(evalT, c.difficulty)}
                      </span>
                    </div>
                    <p className="text-[13px] font-sans text-foreground line-clamp-1 mt-0.5">{c.question}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-lg cursor-pointer h-8"
                      onClick={() => { setEditingCase(c); setCaseFormOpen(true); }}
                    >
                      {evalT.dsEditMetaButton}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-lg cursor-pointer h-8 text-destructive hover:text-destructive"
                      aria-label={`${evalT.caseDeleteTitle} ${c.caseKey}`}
                      onClick={() => setDeletingCase(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* dialogs — mounted only while open so their form state resets per open */}
      {createOpen && (
        <DatasetMetaDialog
          open
          onOpenChange={setCreateOpen}
          mode="create"
          initialName=""
          initialDescription=""
          evalT={evalT}
          onSubmit={handleCreate}
        />
      )}
      {editMetaOpen && (
        <DatasetMetaDialog
          open
          onOpenChange={setEditMetaOpen}
          mode="edit"
          initialName={detail?.name ?? ''}
          initialDescription={detail?.description ?? ''}
          evalT={evalT}
          onSubmit={handleEditMeta}
        />
      )}
      {importOpen && (
        <ImportDialog open onOpenChange={setImportOpen} evalT={evalT} onSubmit={handleImport} />
      )}
      {caseFormOpen && (
        <CaseFormDialog
          open
          onOpenChange={setCaseFormOpen}
          initial={editingCase}
          evalT={evalT}
          onSubmit={handleCaseSubmit}
        />
      )}
      <ConfirmDialog
        open={deleteDatasetOpen}
        onOpenChange={setDeleteDatasetOpen}
        title={evalT.dsDeleteTitle}
        description={evalT.dsDeleteDescription
          .replace('{name}', detail?.name ?? '')
          .replace('{count}', String(detail?.caseCount ?? 0))}
        cancelLabel={evalT.dsCancel}
        confirmLabel={evalT.dsDeleteConfirm}
        busyLabel={evalT.dsDeleting}
        busy={deleteBusy}
        icon={<Trash2 className="h-4 w-4" />}
        onConfirm={handleDeleteDataset}
      />
      <ConfirmDialog
        open={deletingCase !== null}
        onOpenChange={(open) => !open && setDeletingCase(null)}
        title={evalT.caseDeleteTitle}
        description={evalT.caseDeleteDescription.replace('{key}', deletingCase?.caseKey ?? '')}
        cancelLabel={evalT.dsCancel}
        confirmLabel={evalT.dsDeleteConfirm}
        busyLabel={evalT.dsDeleting}
        busy={deleteBusy}
        icon={<Trash2 className="h-4 w-4" />}
        onConfirm={handleDeleteCase}
      />
    </div>
  );
}
