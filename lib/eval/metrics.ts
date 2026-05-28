/**
 * RAG retrieval metrics over a ranked list of relevance grades.
 *
 * Grades are integers in [0, 3] (see lib/eval/relevance.ts). The "relevant"
 * threshold for Recall/Precision/MRR is grade >= 2 (a chunk that's both in the
 * right file and has keyword overlap, OR contains a target substring).
 * NDCG uses raw 0–3 gains.
 *
 * For "out-of-scope" cases that have no ground truth (no targetFileNames and
 * no targetChunkSubstrings), Recall@K is defined as 1 when the system returns
 * zero chunks (correct refusal) and 0 otherwise. Other metrics return 0.
 */

const RELEVANT_THRESHOLD = 2;

export interface CaseMetricInputs {
  grades: number[];
  /** True if the case has no relevant chunks in the corpus (refusal expected). */
  outOfScope: boolean;
}

export function recallAtK(input: CaseMetricInputs, k: number): number {
  const ranked = input.grades.slice(0, k);
  if (input.outOfScope) {
    return ranked.length === 0 ? 1 : 0;
  }
  return ranked.some(g => g >= RELEVANT_THRESHOLD) ? 1 : 0;
}

export function precisionAtK(input: CaseMetricInputs, k: number): number {
  if (input.outOfScope) return 0;
  const ranked = input.grades.slice(0, k);
  if (ranked.length === 0) return 0;
  const hits = ranked.filter(g => g >= RELEVANT_THRESHOLD).length;
  return hits / ranked.length;
}

export function mrr(input: CaseMetricInputs): number {
  if (input.outOfScope) return 0;
  const idx = input.grades.findIndex(g => g >= RELEVANT_THRESHOLD);
  return idx >= 0 ? 1 / (idx + 1) : 0;
}

export function ndcgAtK(input: CaseMetricInputs, k: number): number {
  if (input.outOfScope) return 0;
  const ranked = input.grades.slice(0, k);
  const dcg = ranked.reduce((sum, g, i) => sum + dcgGain(g, i), 0);
  const idealSorted = [...input.grades].sort((a, b) => b - a).slice(0, k);
  const idcg = idealSorted.reduce((sum, g, i) => sum + dcgGain(g, i), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

function dcgGain(grade: number, position: number): number {
  // Standard DCG: (2^rel - 1) / log2(rank + 1)
  return (Math.pow(2, grade) - 1) / Math.log2(position + 2);
}

export interface AggregateInput {
  grades: number[];
  outOfScope: boolean;
}

export interface AggregatedMetrics {
  recallAtK: Record<number, number>;
  precisionAtK: Record<number, number>;
  ndcgAtK: Record<number, number>;
  mrr: number;
}

export function aggregateMetrics(cases: AggregateInput[], ks: number[]): AggregatedMetrics {
  const n = cases.length;
  if (n === 0) {
    const empty: Record<number, number> = {};
    for (const k of ks) empty[k] = 0;
    return { recallAtK: empty, precisionAtK: { ...empty }, ndcgAtK: { ...empty }, mrr: 0 };
  }

  const recall: Record<number, number> = {};
  const precision: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  for (const k of ks) {
    recall[k] = mean(cases.map(c => recallAtK(c, k)));
    precision[k] = mean(cases.map(c => precisionAtK(c, k)));
    ndcg[k] = mean(cases.map(c => ndcgAtK(c, k)));
  }
  const mrrAvg = mean(cases.map(c => mrr(c)));
  return { recallAtK: recall, precisionAtK: precision, ndcgAtK: ndcg, mrr: mrrAvg };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
