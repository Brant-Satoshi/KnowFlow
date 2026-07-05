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
    expectedKeywords: ['kovacs', 'elena'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Dr. Elena Kovacs'],
    notes: 'Tests whether retrieval can find a direct factual answer and the model can extract the person name.',
  },
  {
    id: 'olympus-capital',
    category: 'single_fact',
    difficulty: 'easy',
    question: 'What is the capital of the Olympus Initiative?',
    expectedAnswer: 'Olympus Mons Base.',
    expectedKeywords: ['olympus', 'mons', 'base'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Olympus Mons Base'],
    notes: 'Tests direct factual lookup for a named location.',
  },
  {
    id: 'olympus-stations',
    category: 'list_extraction',
    difficulty: 'medium',
    question: 'Which orbital weather stations does the program operate?',
    expectedAnswer: 'Three stations: Helios, Vesta, and Daedalus.',
    expectedKeywords: ['helios', 'vesta', 'daedalus'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Helios, Vesta, and Daedalus'],
    notes: 'Tests whether the answer includes all required list items without missing one.',
  },
  {
    id: 'olympus-relay-satellite',
    category: 'disambiguation',
    difficulty: 'medium',
    question: 'How is the weather data transmitted to Earth?',
    expectedAnswer: 'Via a relay satellite called Mercury Link.',
    expectedKeywords: ['mercury', 'link', 'relay', 'satellite'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Mercury Link'],
    notes: 'Tests whether retrieval and generation identify the correct transmission method.',
  },
  {
    id: 'olympus-funding',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'How much initial funding did the Olympus Initiative receive, and from whom?',
    expectedAnswer: '420 million credits from the United Mars Consortium.',
    expectedKeywords: ['420', 'million', 'credits', 'consortium'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['420 million credits', 'United Mars Consortium'],
    notes: 'Tests whether the model preserves the exact funding amount and source.',
  },
  {
    id: 'olympus-phase2',
    category: 'synthesis',
    difficulty: 'hard',
    question: 'What is the timeline and focus of Phase 2?',
    expectedAnswer: 'Phase 2 runs from 2027 to 2030 and will extend coverage to the southern polar region.',
    expectedKeywords: ['phase', '2027', '2030', 'southern', 'polar'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['Phase 2', '2027–2030', 'southern polar region'],
    notes: 'Tests whether the answer combines timeline and project focus instead of answering only one part.',
  },
  {
    id: 'olympus-pressure-wave',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'What unusual signal did the Daedalus station detect, and what is its period?',
    expectedAnswer: 'A periodic pressure wave with a 41-hour cycle.',
    expectedKeywords: ['daedalus', 'pressure', 'wave', '41-hour'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['41-hour cycle', 'pressure wave'],
    notes: 'Tests exact extraction of a phenomenon and its numeric period.',
  },
  {
    id: 'olympus-dust-storms',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'By how much did Tharsis dust storms intensify during the 2025 perihelion?',
    expectedAnswer: 'By 18%.',
    expectedKeywords: ['tharsis', 'dust', '18', 'perihelion'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['intensified by 18%', 'Tharsis region'],
    notes: 'Tests whether percentage facts are preserved accurately.',
  },
  {
    id: 'olympus-temperature-range',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: 'What surface temperature range was recorded at Olympus Mons Base in the first year?',
    expectedAnswer: 'From -78°C to -12°C.',
    expectedKeywords: ['temperature', '-78', '-12'],    targetFileNames: ['sample.txt'],
    targetChunkSubstrings: ['-78°C to -12°C'],
    notes: 'Tests whether numeric ranges and negative signs are preserved.',
  },
  {
    id: 'olympus-out-of-scope',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: 'How many people are on staff at the Olympus Initiative?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Tests whether the model refuses or expresses uncertainty when the KB does not contain the answer.',
  },
];

/**
 * Chinese counterpart of `olympus`, built against `tests/fixtures/sample-zh.txt`
 * （《奥林匹斯计划 —— 项目简介》）. Upload that file to a KB and pass that KB's id
 * with `datasetName: 'olympus-zh'`.
 */
const olympusZh: EvalCase[] = [
  {
    id: 'olympus-zh-lead-researcher',
    category: 'single_fact',
    difficulty: 'easy',
    question: '奥林匹斯计划的首席研究员是谁？',
    expectedAnswer: '埃琳娜·科瓦奇博士。',
    expectedKeywords: ['科瓦奇', '埃琳娜'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['埃琳娜·科瓦奇博士'],
    notes: '测试检索能否找到直接的事实答案，以及模型能否提取人名。',
  },
  {
    id: 'olympus-zh-capital',
    category: 'single_fact',
    difficulty: 'easy',
    question: '奥林匹斯计划的中心城市是哪里？',
    expectedAnswer: '奥林匹斯山基地。',
    expectedKeywords: ['奥林匹斯山基地'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['奥林匹斯山基地'],
    notes: '测试对一个具名地点的直接事实查询。',
  },
  {
    id: 'olympus-zh-stations',
    category: 'list_extraction',
    difficulty: 'medium',
    question: '奥林匹斯项目运营哪些轨道气象站？',
    expectedAnswer: '三座气象站：赫利俄斯、维斯塔和代达罗斯。',
    expectedKeywords: ['赫利俄斯', '维斯塔', '代达罗斯'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['赫利俄斯、维斯塔和代达罗斯'],
    notes: '测试答案是否包含所有必需的列表项而没有遗漏。',
  },
  {
    id: 'olympus-zh-relay-satellite',
    category: 'disambiguation',
    difficulty: 'medium',
    question: '气象数据是如何传回地球的？',
    expectedAnswer: '通过一颗名为“水星链路”的中继卫星。',
    expectedKeywords: ['水星链路', '中继', '卫星'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['水星链路'],
    notes: '测试检索与生成是否识别出正确的传输方式。',
  },
  {
    id: 'olympus-zh-funding',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: '奥林匹斯计划获得了多少初始资金，来自谁？',
    expectedAnswer: '由火星联合体提供的 4.2 亿信用点。',
    expectedKeywords: ['4.2 亿', '信用点', '火星联合体'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['4.2 亿信用点', '火星联合体'],
    notes: '测试模型是否保留了准确的资金金额和来源。',
  },
  {
    id: 'olympus-zh-phase2',
    category: 'synthesis',
    difficulty: 'hard',
    question: '奥林匹斯计划第二阶段的时间表和重点是什么？',
    expectedAnswer: '第二阶段从 2027 年到 2030 年，将把覆盖范围扩展到南极地区。',
    expectedKeywords: ['第二阶段', '2027', '2030', '南极'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['第二阶段', '2027 至 2030', '南极地区'],
    notes: '测试答案是否结合了时间表和项目重点，而不是只回答其中一部分。',
  },
  {
    id: 'olympus-zh-pressure-wave',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: '代达罗斯气象站探测到了什么异常信号，其周期是多少？',
    expectedAnswer: '一种周期为 41 小时的周期性压力波。',
    expectedKeywords: ['代达罗斯', '压力波', '41 小时'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['41 小时', '压力波'],
    notes: '测试对某一现象及其数值周期的精确提取。',
  },
  {
    id: 'olympus-zh-dust-storms',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: '在 2025 年近日点期间，塔尔西斯的沙尘暴增强了多少？',
    expectedAnswer: '增强了 18%。',
    expectedKeywords: ['塔尔西斯', '沙尘暴', '18%', '近日点'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['增强了 18%', '塔尔西斯地区'],
    notes: '测试百分比事实是否被准确保留。',
  },
  {
    id: 'olympus-zh-temperature-range',
    category: 'numeric_fact',
    difficulty: 'medium',
    question: '奥林匹斯山基地在第一年记录到的地表温度范围是多少？',
    expectedAnswer: '从 -78°C 到 -12°C。',
    expectedKeywords: ['温度', '-78', '-12'],    targetFileNames: ['sample-zh.txt'],
    targetChunkSubstrings: ['-78°C 到 -12°C'],
    notes: '测试数值范围和负号是否被保留。',
  },
  {
    id: 'olympus-zh-out-of-scope',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: '奥林匹斯计划有多少名工作人员？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '测试当知识库不包含答案时，模型是否会拒答或表达不确定。',
  },
];


const datasets: Record<string, EvalCase[]> = {
  olympus,
  'olympus-zh': olympusZh,
};

/**
 * Canonical out-of-scope predicate. The runner inverts retrieval/citation hit
 * semantics for these cases and the validator exempts them from target checks,
 * so both must key off the same signal: the authored category.
 */
export function isOutOfScope(c: EvalCase): boolean {
  return c.category === 'out_of_scope';
}

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
