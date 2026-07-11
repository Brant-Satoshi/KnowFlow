import { performance } from 'node:perf_hooks';
import { config } from 'dotenv';
import type { EvalCase } from '@/lib/types';

type RecallMode = 'vector' | 'hybrid';
type RerankSetting = 'on' | 'off';

interface CliOptions {
  knowledgeBaseId: string;
  datasetName: string;
  repetitions: number;
  rerank: RerankSetting;
}

interface CaseMeasurement {
  grades: number[];
  outOfScope: boolean;
  retrievalHit: boolean;
  latencyMs: number;
}

interface ModeSummary {
  retrievalHitRate: number;
  recallAtK: Record<number, number>;
  precisionAtK: Record<number, number>;
  ndcgAtK: Record<number, number>;
  mrr: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

config({ path: '.env.local', quiet: true });

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseOptions(): CliOptions {
  const knowledgeBaseId = readFlag('knowledge-base-id');
  if (!knowledgeBaseId) {
    throw new Error(
      'Missing --knowledge-base-id=<uuid>. Seed a demo KB with `pnpm seed:demo` or pass an existing KB id.',
    );
  }

  const repetitionsRaw = readFlag('repetitions') ?? '1';
  const repetitions = Number.parseInt(repetitionsRaw, 10);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
    throw new Error('--repetitions must be an integer between 1 and 20');
  }

  const rerank = readFlag('rerank') ?? 'on';
  if (rerank !== 'on' && rerank !== 'off') {
    throw new Error('--rerank must be on or off');
  }

  return {
    knowledgeBaseId,
    datasetName: readFlag('dataset') ?? 'olympus-zh',
    repetitions,
    rerank,
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function summarize(
  measurements: CaseMeasurement[],
  aggregateMetrics: (
    cases: Array<{ grades: number[]; outOfScope: boolean }>,
    ks: number[],
  ) => Omit<ModeSummary, 'retrievalHitRate' | 'avgLatencyMs' | 'p50LatencyMs' | 'p95LatencyMs'>,
): ModeSummary {
  const metrics = aggregateMetrics(measurements, [1, 3, 5]);
  const latencies = measurements.map(item => item.latencyMs);

  return {
    retrievalHitRate: mean(measurements.map(item => Number(item.retrievalHit))),
    ...metrics,
    avgLatencyMs: mean(latencies),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function printReport(options: CliOptions, summaries: Record<RecallMode, ModeSummary>): void {
  const vector = summaries.vector;
  const hybrid = summaries.hybrid;
  const percentDelta = (a: number, b: number) => `${((b - a) * 100).toFixed(1)} pp`;
  const latencyDelta = (a: number, b: number) => {
    const relative = a === 0 ? 0 : ((b - a) / a) * 100;
    return `${(b - a).toFixed(1)} ms (${relative >= 0 ? '+' : ''}${relative.toFixed(1)}%)`;
  };

  console.log(`Hybrid retrieval A/B — dataset=${options.datasetName}, rerank=${options.rerank}, repetitions=${options.repetitions}`);
  console.log(`Knowledge base: ${options.knowledgeBaseId}`);
  console.log('');
  console.log('| Metric | Vector | Hybrid | Hybrid − Vector |');
  console.log('| --- | ---: | ---: | ---: |');
  console.log(`| Retrieval hit rate | ${formatPercent(vector.retrievalHitRate)} | ${formatPercent(hybrid.retrievalHitRate)} | ${percentDelta(vector.retrievalHitRate, hybrid.retrievalHitRate)} |`);
  for (const k of [1, 3, 5]) {
    console.log(`| Recall@${k} | ${formatPercent(vector.recallAtK[k])} | ${formatPercent(hybrid.recallAtK[k])} | ${percentDelta(vector.recallAtK[k], hybrid.recallAtK[k])} |`);
  }
  console.log(`| Precision@5 | ${formatNumber(vector.precisionAtK[5])} | ${formatNumber(hybrid.precisionAtK[5])} | ${(hybrid.precisionAtK[5] - vector.precisionAtK[5]).toFixed(3)} |`);
  console.log(`| nDCG@3 | ${formatNumber(vector.ndcgAtK[3])} | ${formatNumber(hybrid.ndcgAtK[3])} | ${(hybrid.ndcgAtK[3] - vector.ndcgAtK[3]).toFixed(3)} |`);
  console.log(`| MRR | ${formatNumber(vector.mrr)} | ${formatNumber(hybrid.mrr)} | ${(hybrid.mrr - vector.mrr).toFixed(3)} |`);
  console.log(`| Average latency | ${vector.avgLatencyMs.toFixed(1)} ms | ${hybrid.avgLatencyMs.toFixed(1)} ms | ${latencyDelta(vector.avgLatencyMs, hybrid.avgLatencyMs)} |`);
  console.log(`| p50 latency | ${vector.p50LatencyMs.toFixed(1)} ms | ${hybrid.p50LatencyMs.toFixed(1)} ms | ${latencyDelta(vector.p50LatencyMs, hybrid.p50LatencyMs)} |`);
  console.log(`| p95 latency | ${vector.p95LatencyMs.toFixed(1)} ms | ${hybrid.p95LatencyMs.toFixed(1)} ms | ${latencyDelta(vector.p95LatencyMs, hybrid.p95LatencyMs)} |`);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const [datasetModule, metricsModule, relevanceModule, retrieveModule, pgModule] = await Promise.all([
    import('@/lib/eval/dataset'),
    import('@/lib/eval/metrics'),
    import('@/lib/eval/relevance'),
    import('@/lib/rag/retrieve'),
    import('@/lib/db/pg'),
  ]);

  try {
    const cases = datasetModule.loadDataset(options.datasetName);
    const measurements: Record<RecallMode, CaseMeasurement[]> = { vector: [], hybrid: [] };
    const modeOrders: RecallMode[][] = [
      ['vector', 'hybrid'],
      ['hybrid', 'vector'],
    ];

    for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
        const evalCase: EvalCase = cases[caseIndex];
        const modes = modeOrders[(repetition + caseIndex) % modeOrders.length];

        for (const mode of modes) {
          const startedAt = performance.now();
          const recalled = await retrieveModule.recallChunks(evalCase.question, {
            knowledgeBaseId: options.knowledgeBaseId,
            mode,
          });
          const finalChunks = await retrieveModule.selectFinalChunks(
            evalCase.question,
            recalled,
            options.rerank === 'on' ? 'force' : 'off',
          );
          const latencyMs = performance.now() - startedAt;
          const grades = relevanceModule.gradeRecalled(finalChunks, evalCase);
          const outOfScope = datasetModule.isOutOfScope(evalCase);
          const hasRelevant = grades.some(grade => grade >= 2);

          measurements[mode].push({
            grades,
            outOfScope,
            retrievalHit: outOfScope ? !hasRelevant : hasRelevant,
            latencyMs,
          });
        }
      }
    }

    printReport(options, {
      vector: summarize(measurements.vector, metricsModule.aggregateMetrics),
      hybrid: summarize(measurements.hybrid, metricsModule.aggregateMetrics),
    });
  } finally {
    await pgModule.closePool();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
