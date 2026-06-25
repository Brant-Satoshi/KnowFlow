import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { knowledgeBases } from "./core";

export const evalDatasets = pgTable(
    "eval_datasets",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name").notNull(),
        description: text("description"),

        datasetHash: text("dataset_hash").notNull(),
        caseCount: integer("case_count").notNull(),

        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("eval_datasets_name_unique").on(table.name),
    ]
)

export const evalCases = pgTable(
  "eval_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => evalDatasets.id, { onDelete: "cascade" }),

    caseKey: text("case_key").notNull(),
    question: text("question").notNull(),

    expectedKeywords: jsonb("expected_keywords").$type<string[]>().notNull().default([]),
    category: text("category").notNull(),
    difficulty: text("difficulty").notNull(),

    targetFileNames: jsonb("target_file_names").$type<string[]>().notNull().default([]),
    targetChunkSubstrings: jsonb("target_chunk_substrings").$type<string[]>().notNull().default([]),

    expectedAnswer: text("expected_answer"),
    notes: text("notes"),

    idx: integer("idx").notNull().default(0),
  },
  (table) => [
    index("eval_cases_dataset_idx").on(table.datasetId, table.idx),
  ],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    knowledgeBaseId: uuid("knowledge_base_id").notNull()
     .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .references(() => evalDatasets.id, { onDelete: "set null" }),

    datasetName: text("dataset_name"),
    datasetHash: text("dataset_hash"),
    mode: text("mode").notNull(),
    useRerank: boolean("use_rerank").notNull(),

    totalCases: integer("total_cases").notNull(),
    passedCases: integer("passed_cases").notNull(),

    retrievalHitRate: doublePrecision("retrieval_hit_rate").notNull(),
    citationHitRate: doublePrecision("citation_hit_rate").notNull(),

    avgLatencyMs: integer("avg_latency_ms").notNull(),

    recallAtK: jsonb("recall_at_k").$type<Record<string, number> | null>(),
    precisionAtK: jsonb("precision_at_k").$type<Record<string, number> | null>(),
    ndcgAtK: jsonb("ndcg_at_k").$type<Record<string, number> | null>(),
    mrr: doublePrecision("mrr"),

    avgFaithfulness: doublePrecision("avg_faithfulness"),
    avgAnswerRelevance: doublePrecision("avg_answer_relevance"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
    (table) => [
    index("eval_runs_kb_idx").on(table.knowledgeBaseId, table.createdAt),
    index("eval_runs_hash_idx").on(
      table.knowledgeBaseId,
      table.datasetHash,
      table.createdAt,
    ),
  ],
);


export const evalRunItems = pgTable(
  "eval_run_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    runId: uuid("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),

    idx: integer("idx").notNull(),
    caseKey: text("case_key").notNull(),
    question: text("question").notNull(),

    passed: boolean("passed").notNull(),

    failureReasons: jsonb("failure_reasons").$type<string[]>().notNull().default([]),

    retrievalHit: boolean("retrieval_hit").notNull(),
    citationHit: boolean("citation_hit").notNull(),

    latencyMs: integer("latency_ms").notNull(),

    retrievedChunks: jsonb("retrieved_chunks").$type<unknown[]>().notNull().default([]),
    topKHits: jsonb("top_k_hits").$type<unknown[]>().notNull().default([]),

    answer: text("answer").notNull().default(""),
    expectedAnswer: text("expected_answer"),

    gradedHits: jsonb("graded_hits").$type<unknown[] | null>(),

    faithfulness: doublePrecision("faithfulness"),
    answerRelevance: doublePrecision("answer_relevance"),
  },
  (table) => [
     index("eval_run_items_run_idx").on(table.runId, table.idx),
  ],
);
