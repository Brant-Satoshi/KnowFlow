CREATE TABLE "eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"case_key" text NOT NULL,
	"question" text NOT NULL,
	"expected_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"target_file_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_chunk_substrings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_answer" text,
	"notes" text,
	"idx" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"dataset_hash" text NOT NULL,
	"case_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"case_key" text NOT NULL,
	"question" text NOT NULL,
	"passed" boolean NOT NULL,
	"failure_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieval_hit" boolean NOT NULL,
	"citation_hit" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"retrieved_chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"top_k_hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"expected_answer" text,
	"graded_hits" jsonb
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"dataset_id" uuid,
	"dataset_name" text,
	"dataset_hash" text,
	"mode" text NOT NULL,
	"use_rerank" boolean NOT NULL,
	"total_cases" integer NOT NULL,
	"passed_cases" integer NOT NULL,
	"retrieval_hit_rate" double precision NOT NULL,
	"citation_hit_rate" double precision NOT NULL,
	"avg_latency_ms" integer NOT NULL,
	"recall_at_k" jsonb,
	"precision_at_k" jsonb,
	"ndcg_at_k" jsonb,
	"mrr" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_dataset_id_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_items" ADD CONSTRAINT "eval_run_items_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_dataset_id_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_dataset_idx" ON "eval_cases" USING btree ("dataset_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_datasets_name_unique" ON "eval_datasets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "eval_run_items_run_idx" ON "eval_run_items" USING btree ("run_id","idx");--> statement-breakpoint
CREATE INDEX "eval_runs_kb_idx" ON "eval_runs" USING btree ("knowledge_base_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_hash_idx" ON "eval_runs" USING btree ("knowledge_base_id","dataset_hash","created_at");