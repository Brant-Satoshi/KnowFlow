// One-off backfill: re-parse + re-embed every file with contextual embedding
// text (document/section titles). Run after migration 008:
//
//   pnpm reembed
//
// dotenv is loaded first, and app modules are imported dynamically afterwards,
// because lib/db/pg.ts throws at import time when DATABASE_URL is unset.
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { getFiles, updateFileStatus } = await import('@/lib/db/files');
  const { reindexFile } = await import('@/lib/rag/reindex');
  const { closePool } = await import('@/lib/db/pg');

  const files = await getFiles();
  console.log(`Re-embedding ${files.length} file(s) with contextual text...`);

  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const count = await reindexFile(file);
      await updateFileStatus(file.id, 'indexed');
      ok += 1;
      console.log(`  ✓ ${file.name} → ${count} chunks`);
    } catch (e) {
      failed += 1;
      await updateFileStatus(file.id, 'failed').catch(() => {});
      const message = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ ${file.name} → ${message}`);
    }
  }

  console.log(`Done. ${ok} re-embedded, ${failed} failed.`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
