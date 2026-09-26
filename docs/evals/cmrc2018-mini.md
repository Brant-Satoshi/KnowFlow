# CMRC 2018 mini evaluation set

This fixture contains 100 Chinese questions from 25 passages of the **development** split of [CMRC 2018](https://github.com/ymcui/cmrc2018). It is registered as `cmrc2018-mini` in `/eval`. The [original authors' project page](https://ymcui.com/cmrc2018/) identifies the dataset as CC BY-SA 4.0; these selected passages and questions retain that attribution and license. The official hidden test split is not used.

Source: [`cmrc2018_dev.json` at commit `c0eb1b6ba219847457e6af3180da722bbeb656af`](https://github.com/ymcui/cmrc2018/blob/c0eb1b6ba219847457e6af3180da722bbeb656af/data/cmrc2018_dev.json). SHA-256 of the raw source JSON: `5cfe4414c28a8ecbb51670f78c0dc7d1049f286c2d5769b52f1f94bcc0752cf1`.

The generator walks source passages in their original order. It keeps passages with four distinct answers, a question that explicitly names the passage subject, an answer found verbatim in the passage, and a unique evidence excerpt contained in an indexed chunk. Two source annotations with contradictory or corrupted answers were excluded after spot checks. It takes four questions from each of the first 25 eligible passages. This yields 100 answerable questions. The generated text files are in `tests/fixtures/cmrc2018-*.txt`; their file names match the references in `lib/eval/cmrc2018-mini.json`.

## Rebuild and check

```sh
pnpm import:cmrc2018
pnpm import:cmrc2018 -- --check
```

The script downloads the pinned source and checks its SHA-256. For offline use, download the pinned JSON once and pass `--source=/path/to/cmrc2018_dev.json` to either command. `--check` compares every generated file byte for byte without changing it.

## Run in KnowFlow

1. Create a knowledge base for this fixture.
2. Upload the 25 `tests/fixtures/cmrc2018-*.txt` files **with their original names**. The current upload panel accepts one file at a time. Wait until every file has status `indexed`.
3. On `/eval`, choose that knowledge base and `cmrc2018-mini`. Check that all 25 uploads are indexed. The Dataset tab checks the repository fixtures, not the selected knowledge base; confirm zero fixture errors and warnings, then run the evaluation.

The reference answers live only in the evaluation JSON. Upload the TXT passages, not the JSON. No database seed, migration, or re-embedding is needed for this fixture.

This set measures retrieval and generated answers over these 25 passages. It has no unanswerable questions, so refusal metrics are unavailable; use `olympus-zh` to exercise refusal behavior. The current runner uses `expectedAnswer` for display but does not directly score answer correctness against it. Hit@K also does not measure complete evidence recall. The set is a local regression fixture, not an official CMRC leaderboard submission.
