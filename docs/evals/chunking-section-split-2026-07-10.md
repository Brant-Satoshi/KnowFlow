# Section-bounded chunking A/B — 2026-07-10

## Change under test

`chunkText` (`lib/rag/chunks.ts`) now treats section headings (`一、` / markdown `#`) as hard chunk boundaries: the sliding window runs per section segment, overlap never crosses a heading, and every chunk's `sectionTitle` (used in `embedding_text` for the vector, keyword, and rerank legs) is exactly the section its text belongs to. Before the change, chunks straddled headings, so content after a mid-chunk heading was embedded and reranked under the *previous* section's label.

Corpus effect on the demo KB: 24 chunks (~460 chars, most spanning two sections) → 37 chunks (zh file: one chunk per section, 199–380 chars; en file unchanged — its `Key facts:` style headings match no heading rule).

## Setup

- Corpus: deterministic `pnpm seed:demo` KB (`00000000-0000-4000-8000-000000000103`), re-seeded before each side of the comparison.
- Dataset: `olympus-zh`, 10 cases. Same protocol as `hybrid-ab-2026-07-10.md`; the comparison axis here is the **Vector column before vs after** (chat recall is vector-only by default, ADR-010).
- Latency covers query embedding + DB recall + optional rerank through the final top-5.

## Raw recall, vector leg (`--rerank=off --repetitions=3`)

| Metric | Before | After | After − Before |
| --- | ---: | ---: | ---: |
| Retrieval hit rate | 100.0% | 100.0% | 0.0 pp |
| Recall@1 | 90.0% | 70.0% | **-20.0 pp** |
| Recall@3 | 90.0% | 90.0% | 0.0 pp |
| Recall@5 | 90.0% | 90.0% | 0.0 pp |
| Precision@5 | 0.700 | 0.625 | -0.075 |
| nDCG@3 | 0.808 | 0.795 | -0.013 |
| MRR | 0.900 | 0.800 | -0.100 |

## Production-style rerank, vector leg (`--rerank=on --repetitions=1`)

| Metric | Before | After | After − Before |
| --- | ---: | ---: | ---: |
| Retrieval hit rate | 100.0% | 100.0% | 0.0 pp |
| Recall@1 | 90.0% | 90.0% | 0.0 pp |
| Recall@3 | 90.0% | 90.0% | 0.0 pp |
| Recall@5 | 90.0% | 90.0% | 0.0 pp |
| Precision@5 | 0.760 | 0.745 | -0.015 |
| nDCG@3 | 0.883 | 0.880 | -0.003 |
| MRR | 0.900 | 0.900 | 0.000 |

## Reading the raw-recall regression

Per-case inspection shows exactly two cases lost rank-1, and in both the relevant chunk sits at rank 2:

- `olympus-zh-phase2` (“第二阶段的时间表和重点是什么？”): rank 1 is now `十三、第一阶段时间表` (irrelevant sibling), `十四、第二阶段时间表` at rank 2. Before the change 十三/十四 shared a straddling chunk, so the mixed chunk collected the rank-1 credit — part of the old Recall@1 was an artifact of straddling, not genuinely better ranking.
- `olympus-zh-relay-satellite` (“气象数据是如何传回地球的？”): `十、观测数据类型` edges out `八、“水星链路”中继卫星`.

Both are sibling-section confusions on cosine similarity alone. The evidence still reaches the prompt in every configuration (Recall@5 unchanged at 90.0%), and the production rerank restores the ordering entirely (Recall@1 90.0%, MRR 0.900). Separately, `三十一、关键事实摘要` becoming its own chunk makes it a grade-3 hit for 5 of 9 in-scope cases — section-pure chunks give the summary section its own strong embedding.

## Verdict

Ship. The change fixes a correctness bug (wrong `section:` labels in `embedding_text` for every straddling chunk) and cleans up citations (chunks begin at their heading). On the production path (vector recall + rerank) all quality metrics are flat within noise. The raw-recall Recall@1/MRR drop is confined to two sibling-section flips where the answer stays at rank 2 and inside the top-5; rerank — on by default — erases it. Revisit only if a target corpus must run with `RERANK_ENABLED=false` and shows sibling-heavy structure; options then would be section-title boosting or small-section merging, measured by this same protocol.

Existing KBs keep their old chunks until re-indexed: run `pnpm reembed` (re-parses and re-chunks every file) to migrate them.

## Reproduce

```bash
pnpm seed:demo
pnpm eval:hybrid-ab -- --knowledge-base-id=00000000-0000-4000-8000-000000000103 --dataset=olympus-zh --rerank=off --repetitions=3
pnpm eval:hybrid-ab -- --knowledge-base-id=00000000-0000-4000-8000-000000000103 --dataset=olympus-zh --rerank=on --repetitions=1
pnpm test:unit   # chunkText invariants: no straddling, per-section titles, overlap stays in-section
```
