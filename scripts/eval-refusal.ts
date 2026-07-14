/**
 * Calibrate RETRIEVAL.minRerankScore — the rerank-score floor below which the
 * chat refuses instead of answering (lib/rag/refusal-gate.ts).
 *
 * Retrieval runs once per case; the threshold sweep is then pure arithmetic over
 * the recorded scores, so every candidate floor is evaluated on identical
 * retrievals. No LLM is called — the gate's decision depends only on rerank
 * scores.
 *
 * Two rules decide the floor:
 *   1. inScopeFalseRefusal must be 0. Refusing a question the corpus *can*
 *      answer is a worse failure than the one we are fixing.
 *   2. Subject to (1), take the floor that refuses the most out-of-scope cases.
 *
 * Calibrate on one dataset and validate on the other (`--validate=`): a threshold
 * chosen and blessed on the same handful of negatives is fitted to them. If the
 * validation split disagrees, the honest answer is to keep the floor at 0 and
 * ship only the empty-retrieval refusal.
 *
 *   pnpm eval:refusal -- --knowledge-base-id=<uuid> --dataset=olympus \
 *                        --validate-knowledge-base-id=<uuid> --validate=olympus-zh
 */
import { config } from 'dotenv';
import type { EvalCase } from '@/lib/types';

config({ path: '.env.local', quiet: true });

interface CaseScore {
  id: string;
  question: string;
  outOfScope: boolean;
  /** null when retrieval came back empty — refused by the 'empty' rule, floor irrelevant. */
  maxRerankScore: number | null;
  finalCount: number;
}

interface ThresholdRow {
  threshold: number;
  oosRefusalRate: number;
  inScopeFalseRefusalRate: number;
}

/**
 * How far a floor must sit below the lowest-scoring answerable question before we
 * believe it. Anything tighter is fitted to which question happened to score
 * lowest in a small sample.
 */
const MIN_SAFE_MARGIN = 0.05;

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Would the gate refuse this case at `threshold`? Mirrors assessRetrieval:
 * empty retrieval always refuses; otherwise the floor applies only where a
 * rerank score exists.
 */
function refusesAt(c: CaseScore, threshold: number): boolean {
  if (c.finalCount === 0) return true;
  if (threshold <= 0) return false;
  if (c.maxRerankScore === null) return false;
  return c.maxRerankScore < threshold;
}

function sweep(scores: CaseScore[], thresholds: number[]): ThresholdRow[] {
  const oos = scores.filter(s => s.outOfScope);
  const inScope = scores.filter(s => !s.outOfScope);

  return thresholds.map(threshold => ({
    threshold,
    oosRefusalRate: oos.length
      ? oos.filter(s => refusesAt(s, threshold)).length / oos.length
      : 0,
    inScopeFalseRefusalRate: inScope.length
      ? inScope.filter(s => refusesAt(s, threshold)).length / inScope.length
      : 0,
  }));
}

/**
 * Best floor that costs nothing.
 *
 * The bar is not "refuses no answerable question" but "refuses no answerable
 * question that a floor of 0 wasn't already refusing". An in-scope case whose
 * recall comes back empty is refused by the empty-retrieval rule at every floor;
 * that is a recall miss, and blaming the floor for it would rule out every
 * threshold including the one we already ship.
 *
 * Among the floors that add no false refusal, take the one refusing the most
 * out-of-scope cases; where several tie, take the middle of the tied band so the
 * threshold sits as far as possible from both score distributions.
 */
function pickThreshold(rows: ThresholdRow[]): ThresholdRow | null {
  const baseline = rows.find(r => r.threshold === 0)?.inScopeFalseRefusalRate ?? 0;
  const safe = rows.filter(r => r.inScopeFalseRefusalRate <= baseline);
  if (safe.length === 0) return null;

  const best = Math.max(...safe.map(r => r.oosRefusalRate));
  const tied = safe.filter(r => r.oosRefusalRate === best);
  return tied[Math.floor(tied.length / 2)];
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const score = (v: number | null) => (v === null ? '  —  ' : v.toFixed(4));

async function collect(
  datasetName: string,
  knowledgeBaseId: string,
): Promise<CaseScore[]> {
  const [datasetModule, retrieveModule, gateModule] = await Promise.all([
    import('@/lib/eval/dataset'),
    import('@/lib/rag/retrieve'),
    import('@/lib/rag/refusal-gate'),
  ]);

  const cases: EvalCase[] = datasetModule.loadDataset(datasetName);
  const scores: CaseScore[] = [];

  for (const c of cases) {
    const recalled = await retrieveModule.recallChunks(c.question, { knowledgeBaseId });
    // 'force': the floor only ever applies to scores a reranker actually produced,
    // so calibrate against a run where it definitely did.
    const finalChunks = await retrieveModule.selectFinalChunks(c.question, recalled, 'force');

    scores.push({
      id: c.id,
      question: c.question,
      outOfScope: datasetModule.isOutOfScope(c),
      maxRerankScore: gateModule.maxRerankScore(finalChunks),
      finalCount: finalChunks.length,
    });
  }

  return scores;
}

function printScores(label: string, scores: CaseScore[]): void {
  console.log(`\n## ${label} — best rerank score per case\n`);
  console.log('| scope | score | chunks | case |');
  console.log('| --- | ---: | ---: | --- |');
  for (const s of [...scores].sort((a, b) => Number(a.outOfScope) - Number(b.outOfScope))) {
    const scope = s.outOfScope ? 'OOS' : 'in ';
    console.log(`| ${scope} | ${score(s.maxRerankScore)} | ${s.finalCount} | ${s.id} |`);
  }
}

function printSweep(label: string, rows: ThresholdRow[]): void {
  const baseline = rows.find(r => r.threshold === 0)?.inScopeFalseRefusalRate ?? 0;

  console.log(`\n## ${label} — threshold sweep\n`);
  console.log(
    `(in-scope refusals at floor 0: ${pct(baseline)} — recall misses, refused by the empty rule` +
      ` at any floor. A usable floor must not push this number higher.)\n`,
  );
  console.log('| floor | OOS refused (want high) | in-scope wrongly refused |');
  console.log('| ---: | ---: | ---: |');
  for (const r of rows) {
    const flag = r.inScopeFalseRefusalRate > baseline ? '  ✗ costs a real answer' : '';
    console.log(
      `| ${r.threshold.toFixed(3)} | ${pct(r.oosRefusalRate)} | ${pct(r.inScopeFalseRefusalRate)}${flag} |`,
    );
  }
}

/** The separation the floor depends on: it can only work if these two don't overlap. */
function printSeparation(scores: CaseScore[]): void {
  const scored = scores.filter(s => s.maxRerankScore !== null);
  const inScope = scored.filter(s => !s.outOfScope).map(s => s.maxRerankScore!);
  const oos = scored.filter(s => s.outOfScope).map(s => s.maxRerankScore!);
  if (inScope.length === 0 || oos.length === 0) return;

  const lowestAnswerable = Math.min(...inScope);
  const highestUnanswerable = Math.max(...oos);

  console.log('\n## Can a floor separate them at all?\n');
  console.log(`  lowest-scoring answerable question:   ${lowestAnswerable.toFixed(4)}`);
  console.log(`  highest-scoring unanswerable question: ${highestUnanswerable.toFixed(4)}`);
  console.log(
    highestUnanswerable >= lowestAnswerable
      ? `  => OVERLAP. The reranker scores at least one question the corpus cannot answer\n` +
          `     ABOVE one it can. No single floor can refuse the first without refusing the\n` +
          `     second — a floor here buys refusals by breaking real answers.`
      : `  => separable: any floor strictly between them refuses only unanswerable questions.`,
  );
}

async function main(): Promise<void> {
  const knowledgeBaseId = readFlag('knowledge-base-id');
  if (!knowledgeBaseId) {
    throw new Error('Missing --knowledge-base-id=<uuid>. Seed one with `pnpm seed:demo`.');
  }
  const datasetName = readFlag('dataset') ?? 'olympus';
  const validateDataset = readFlag('validate');
  const validateKbId = readFlag('validate-knowledge-base-id');

  const { closePool } = await import('@/lib/db/pg');
  const { resolveRerankProvider } = await import('@/lib/models');
  const { CALIBRATED_RERANK_MODEL } = await import('@/lib/rag/refusal-gate');

  try {
    const rerankModel = resolveRerankProvider().model;
    console.log(`Refusal-floor calibration — rerank model: ${rerankModel}`);
    if (rerankModel !== CALIBRATED_RERANK_MODEL) {
      // Scores are not comparable across rerankers; a floor measured here would
      // not mean anything under the model the gate actually checks for.
      console.log(
        `\n!! The gate only applies its floor to ${CALIBRATED_RERANK_MODEL}. Calibrating against` +
          `\n!! ${rerankModel} produces a number the gate will ignore. Set OPENROUTER_RERANK_MODEL and re-run.`,
      );
    }

    // Cohere relevance scores span [0, 1] and cluster high, so sweep the range.
    const thresholds = Array.from({ length: 39 }, (_, i) => i * 0.025);

    const calib = await collect(datasetName, knowledgeBaseId);
    printScores(`${datasetName} (calibration)`, calib);
    printSeparation(calib);
    const calibRows = sweep(calib, thresholds);
    printSweep(`${datasetName} (calibration)`, calibRows);

    const chosen = pickThreshold(calibRows);
    if (!chosen) {
      console.log('\n=> No floor is free of cost on this corpus. Keep minRerankScore = 0.');
      return;
    }
    if (chosen.threshold === 0) {
      console.log(
        '\n=> No floor above 0 refuses anything extra without breaking a real answer.' +
          '\n   Keep RETRIEVAL.minRerankScore = 0 (empty-retrieval refusal only).',
      );
      return;
    }
    const baseline = calibRows[0].inScopeFalseRefusalRate;
    const scoredInScope = calib
      .filter(s => !s.outOfScope && s.maxRerankScore !== null)
      .map(s => s.maxRerankScore!);
    const margin = Math.min(...scoredInScope) - chosen.threshold;

    console.log(
      `\n=> Best floor on ${datasetName}: ${chosen.threshold.toFixed(3)}` +
        `  (refuses ${pct(chosen.oosRefusalRate)} of out-of-scope; in-scope refusals` +
        ` unchanged at ${pct(baseline)})`,
    );
    console.log(
      `   Margin to the lowest-scoring answerable question: ${margin.toFixed(4)}`,
    );
    if (margin < MIN_SAFE_MARGIN) {
      // With a handful of in-scope cases, the lowest observed score is a sample
      // minimum, not the population's. A floor this close to it is not calibrated,
      // it is lucky — the next answerable question that scores a little lower gets
      // refused.
      console.log(
        `   !! That margin is inside the noise (< ${MIN_SAFE_MARGIN}). The lowest score among a` +
          `\n   !! handful of answerable questions is a sample minimum; real ones will fall below` +
          `\n   !! it. Do not ship this floor.`,
      );
    }

    if (validateDataset && validateKbId) {
      const holdout = await collect(validateDataset, validateKbId);
      printScores(`${validateDataset} (held out)`, holdout);
      printSeparation(holdout);

      const [atFloor] = sweep(holdout, [chosen.threshold]);
      const [atZero] = sweep(holdout, [0]);
      console.log(`\n## ${validateDataset} (held out) — at the chosen floor\n`);
      console.log(`  out-of-scope refused:      ${pct(atFloor.oosRefusalRate)}`);
      console.log(
        `  in-scope wrongly refused:  ${pct(atFloor.inScopeFalseRefusalRate)}` +
          `  (empty-retrieval baseline: ${pct(atZero.inScopeFalseRefusalRate)})`,
      );
      if (atFloor.inScopeFalseRefusalRate > atZero.inScopeFalseRefusalRate) {
        console.log(
          `\n!! On negatives it was NOT chosen against, this floor refuses answerable questions.` +
            `\n!! It is fitted to ${datasetName}, not to the reranker. Keep minRerankScore = 0.`,
        );
      }
    } else {
      console.log(
        '\n(no held-out set: pass --validate=<dataset> --validate-knowledge-base-id=<uuid>' +
          '\n to check the floor against negatives it was not chosen on)',
      );
    }
  } finally {
    await closePool();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
