import type { EvalCase } from '@/lib/types';

/**
 * Curated eval datasets registered by name.
 *
 * Each dataset is bound to a logical document set, not a specific knowledge_base_id.
 * Callers pass `knowledgeBaseId` separately; the KB must contain files whose names
 * match the cases' `targetFileNames` for grade-1/2 signals to fire.
 *
 * The `olympus` dataset is built against `tests/fixtures/sample.txt`
 * ("The Olympus Initiative — Project Brief"). To use it, upload that file to a KB
 * and pass that KB's id with `datasetName: 'olympus'`.
 */
const olympus: EvalCase[] = [
  {
    id: 'olympus-lead-researcher',
    category: 'single_fact',
    difficulty: 'easy',
    question: 'Who is the lead researcher of the Olympus Initiative?',
    expectedAnswer: 'Dr. Elena Kovacs.',
    expectedKeywords: ['kovacs', 'elena'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Dr. Elena Kovacs'],
    notes: 'Tests whether retrieval can find a direct factual answer and the model can extract the person name.',
  },
  {
    id: 'olympus-capital',
    category: 'single_fact',
    difficulty: 'easy',
    question: 'What is the capital of the Olympus Initiative?',
    expectedAnswer: 'Olympus Mons Base.',
    expectedKeywords: ['olympus', 'mons', 'base'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Olympus Mons Base'],
    notes: 'Tests direct factual lookup for a named location.',
  },
  {
    id: 'olympus-stations',
    category: 'list_extraction',
    difficulty: 'medium',
    question: 'Which orbital weather stations does the program operate?',
    expectedAnswer: 'Three stations: Helios, Vesta, and Daedalus.',
    expectedKeywords: ['helios', 'vesta', 'daedalus'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Helios, Vesta, and Daedalus'],
    notes: 'Tests whether the answer includes all required list items without missing one.',
  },
  {
    id: 'olympus-relay-satellite',
    category: 'disambiguation',
    difficulty: 'medium',
    question: 'How is the weather data transmitted to Earth?',
    expectedAnswer: 'Via a relay satellite called Mercury Link.',
    expectedKeywords: ['mercury', 'link', 'relay', 'satellite'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Mercury Link'],
    notes: 'Tests whether retrieval and generation identify the correct transmission method.',
  },
  {
    id: 'olympus-funding',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'How much initial funding did the Olympus Initiative receive, and from whom?',
    expectedAnswer: '420 million credits from the United Mars Consortium.',
    expectedKeywords: ['420', 'million', 'credits', 'consortium'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['420 million credits', 'United Mars Consortium'],
    notes: 'Tests whether the model preserves the exact funding amount and source.',
  },
  {
    id: 'olympus-phase2',
    category: 'synthesis',
    difficulty: 'hard',
    question: 'What is the timeline and focus of Phase 2?',
    expectedAnswer: 'Phase 2 runs from 2027 to 2030 and will extend coverage to the southern polar region.',
    expectedKeywords: ['phase', '2027', '2030', 'southern', 'polar'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Phase 2', '2027–2030', 'southern polar region'],
    notes: 'Tests whether the answer combines timeline and project focus instead of answering only one part.',
  },
  {
    id: 'olympus-pressure-wave',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'What unusual signal did the Daedalus station detect, and what is its period?',
    expectedAnswer: 'A periodic pressure wave with a 41-hour cycle.',
    expectedKeywords: ['daedalus', 'pressure', 'wave', '41-hour'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['41-hour cycle', 'pressure wave'],
    notes: 'Tests exact extraction of a phenomenon and its numeric period.',
  },
  {
    id: 'olympus-dust-storms',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'By how much did Tharsis dust storms intensify during the 2025 perihelion?',
    expectedAnswer: 'By 18%.',
    expectedKeywords: ['tharsis', 'dust', '18', 'perihelion'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['intensified by 18%', 'Tharsis region'],
    notes: 'Tests whether percentage facts are preserved accurately.',
  },
  {
    id: 'olympus-temperature-range',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'What surface temperature range was recorded at Olympus Mons Base in the first year?',
    expectedAnswer: 'From -78°C to -12°C.',
    expectedKeywords: ['temperature', '-78', '-12'],
    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['-78°C to -12°C'],
    notes: 'Tests whether numeric ranges and negative signs are preserved.',
  },
  {
    id: 'olympus-out-of-scope',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: 'How many people are on staff at the Olympus Initiative?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],
    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Tests whether the model refuses or expresses uncertainty when the KB does not contain the answer.',
  },
];


const datasets: Record<string, EvalCase[]> = {
  olympus,
};

export function loadDataset(name: string): EvalCase[] {
  const cases = datasets[name];
  if (!cases) {
    throw new Error(`unknown_dataset:${name}`);
  }
  return cases;
}

export function listDatasetNames(): string[] {
  return Object.keys(datasets);
}
