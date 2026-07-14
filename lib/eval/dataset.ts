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
  // Out-of-scope cases: questions the corpus cannot answer. A threshold picked
  // against one easy negative is a threshold fitted to noise, so these span the
  // ways a question can be unanswerable — from trivially unrelated to a
  // near-miss that reuses the document's own vocabulary and asks for the one
  // fact it never states. The near-misses are the ones that decide the floor:
  // they score high on any reranker and are exactly where a model invents.
  {
    id: 'olympus-out-of-scope',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: 'How many people are on staff at the Olympus Initiative?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'In-domain entity, absent fact: the brief never gives a headcount.',
  },
  {
    id: 'olympus-oos-phase2-budget',
    category: 'out_of_scope',
    difficulty: 'hard',
    question: 'How many credits were allocated to Phase 2 of the Olympus Initiative?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Near-miss: the brief gives initial funding (420M) and describes Phase 2, but never budgets Phase 2. Invites borrowing the wrong number.',
  },
  {
    id: 'olympus-oos-tharsis-attribution',
    category: 'out_of_scope',
    difficulty: 'hard',
    question: 'Which orbital station recorded the 18% dust-storm intensification in the Tharsis region?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Near-miss: the 18%/Tharsis finding and the three station names are both in the corpus, but the finding is never attributed to a station. Presupposes a fact not in evidence.',
  },
  {
    id: 'olympus-oos-relay-latency',
    category: 'out_of_scope',
    difficulty: 'hard',
    question: 'What is the transmission latency of the Mercury Link relay satellite?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Near-miss: Mercury Link exists and "every 90 minutes" appears (as a recording interval), tempting the model to report it as latency.',
  },
  {
    id: 'olympus-oos-future-window',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: 'What did the Daedalus station observe in 2031?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Out of the timeline: the brief ends at Phase 2 (2027–2030).',
  },
  {
    id: 'olympus-oos-adjacent-program',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: 'Who is the lead researcher of the Artemis Initiative?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Adjacent subject: same question shape as a case the corpus does answer, about a program it never mentions.',
  },
  {
    id: 'olympus-oos-unrelated',
    category: 'out_of_scope',
    difficulty: 'easy',
    question: 'What is the best way to cook a risotto?',
    expectedAnswer: 'The document does not say.',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: 'Baseline: nothing in the corpus is even topically close. If this one is not refused, nothing else will be.',
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
  // 负样本（out_of_scope）：文档回答不了的问题。只用一条容易的负样本去选阈值，
  // 选到的是噪声；因此这里覆盖「不可回答」的几种形态——从完全无关，到复用文档
  // 自身词汇、却偏偏问它唯一没写的那个事实的近似负样本。近似负样本才是决定
  // 分数下限的关键：它们在任何 reranker 上都得分很高，也正是模型最容易编造的地方。
  {
    id: 'olympus-zh-out-of-scope',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: '奥林匹斯计划有多少名工作人员？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '同域实体、缺失事实：文档从未给出人员编制。',
  },
  {
    id: 'olympus-zh-oos-phase2-budget',
    category: 'out_of_scope',
    difficulty: 'hard',
    question: '第二阶段的预算是多少信用点？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '近似负样本：文档给了初始资金 4.2 亿信用点，并明确说「后续预算需在第一阶段评审后确认」——即第二阶段预算恰恰没写，极易诱导模型套用初始资金。',
  },
  {
    id: 'olympus-zh-oos-tharsis-attribution',
    category: 'out_of_scope',
    difficulty: 'hard',
    question: '是哪一座气象站记录到塔尔西斯地区尘暴增强 18%？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '近似负样本：文档既有「塔尔西斯尘暴增强 18%」，也有「赫利俄斯每天多次飞越塔尔西斯」，但从未把这一发现归属到某座气象站。问题预设了一个文档没有的事实。',
  },
  {
    id: 'olympus-zh-oos-ground-station-count',
    category: 'out_of_scope',
    difficulty: 'hard',
    question: '地面观测网络一共有多少个无人气象点？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '近似负样本：文档只说「设置多个无人气象点」，从未给出数量，但周围段落数字密集（每十五分钟、每九十分钟），诱导模型凑一个数。',
  },
  {
    id: 'olympus-zh-oos-future-window',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: '代达罗斯气象站在 2031 年观测到了什么？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '时间越界：文档的时间线止于第二阶段（2027–2030）。',
  },
  {
    id: 'olympus-zh-oos-adjacent-program',
    category: 'out_of_scope',
    difficulty: 'medium',
    question: '阿尔忒弥斯计划的首席研究员是谁？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '相邻主题：与「首席研究员是谁」这一可回答问题同形，但问的是文档从未提及的另一个计划。',
  },
  {
    id: 'olympus-zh-oos-unrelated',
    category: 'out_of_scope',
    difficulty: 'easy',
    question: '红烧肉怎么做最好吃？',
    expectedAnswer: '文档未说明。',
    expectedKeywords: [],    targetFileNames: [],
    targetChunkSubstrings: [],
    notes: '基线：语料里没有任何话题接近它。这条都拒不掉，其他就更别提了。',
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
