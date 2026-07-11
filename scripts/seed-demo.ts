import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { chunkText } from '@/lib/rag/chunks';
import { cleanText } from '@/lib/rag/text';

const DEMO_USER_ID = '00000000-0000-4000-8000-000000000101';
const DEMO_WORKSPACE_ID = '00000000-0000-4000-8000-000000000102';
export const DEMO_KNOWLEDGE_BASE_ID = '00000000-0000-4000-8000-000000000103';

const FIXTURES = [
  { id: '00000000-0000-4000-8000-000000000111', name: 'sample-zh.txt' },
  { id: '00000000-0000-4000-8000-000000000112', name: 'sample.txt' },
] as const;

config({ path: '.env.local', quiet: true });

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const email = process.env.DEMO_SEED_EMAIL?.trim() || 'demo@knowflow.local';
  const password = process.env.DEMO_SEED_PASSWORD || 'KnowFlowDemo2026!';

  const fixtureInputs = await Promise.all(
    FIXTURES.map(async fixture => ({
      ...fixture,
      text: await readFile(resolve(process.cwd(), 'tests', 'fixtures', fixture.name), 'utf8'),
    })),
  );

  const chunkInputs = fixtureInputs.map(fixture => ({
    ...fixture,
    chunks: chunkText(cleanText(fixture.text), fixture.id, { fileName: fixture.name }),
  }));

  if (dryRun) {
    console.log(`Demo seed dry run: ${chunkInputs.length} files, ${chunkInputs.reduce((sum, file) => sum + file.chunks.length, 0)} chunks`);
    console.log(`Knowledge base id: ${DEMO_KNOWLEDGE_BASE_ID}`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set (checked process env and .env.local)');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set; demo chunks must be embedded before they can be seeded');
  }

  const [passwordModule, embeddingsModule, pgModule, authSchema, coreSchema, drizzle] = await Promise.all([
    import('@/lib/auth/password'),
    import('@/lib/rag/embeddings'),
    import('@/lib/db/pg'),
    import('@/lib/db/schema/auth'),
    import('@/lib/db/schema/core'),
    import('drizzle-orm'),
  ]);

  try {
    const passwordHash = await passwordModule.hashPassword(password);
    const embeddedFiles = await Promise.all(
      chunkInputs.map(async file => ({
        ...file,
        chunks: await embeddingsModule.embedChunk(file.chunks),
      })),
    );

    const { db } = pgModule;
    const { users, workspaces, workspaceMembers } = authSchema;
    const { knowledgeBases, files, chunks } = coreSchema;

    await db.transaction(async tx => {
      await tx
        .delete(users)
        .where(
          drizzle.or(
            drizzle.eq(users.id, DEMO_USER_ID),
            drizzle.sql`lower(${users.email}) = lower(${email})`,
          ),
        );

      await tx.insert(users).values({ id: DEMO_USER_ID, email, passwordHash });
      await tx.insert(workspaces).values({
        id: DEMO_WORKSPACE_ID,
        name: 'KnowFlow Demo Workspace',
        ownerId: DEMO_USER_ID,
      });
      await tx.insert(workspaceMembers).values({
        workspaceId: DEMO_WORKSPACE_ID,
        userId: DEMO_USER_ID,
        role: 'owner',
      });
      await tx.insert(knowledgeBases).values({
        id: DEMO_KNOWLEDGE_BASE_ID,
        userId: DEMO_USER_ID,
        workspaceId: DEMO_WORKSPACE_ID,
        name: 'Olympus Demo',
        description: 'Deterministic bilingual corpus for chat and retrieval evaluation demos.',
      });

      for (const file of embeddedFiles) {
        await tx.insert(files).values({
          id: file.id,
          name: file.name,
          type: 'text/plain',
          size: Buffer.byteLength(file.text),
          status: 'indexed',
          knowledgeBaseId: DEMO_KNOWLEDGE_BASE_ID,
        });
        await tx.insert(chunks).values(
          file.chunks.map(chunk => ({
            id: chunk.id,
            fileId: file.id,
            idx: chunk.idx,
            text: chunk.text,
            embeddingText: chunk.embeddingText ?? chunk.text,
            documentTitle: chunk.documentTitle ?? null,
            sectionTitle: chunk.sectionTitle ?? null,
            meta: chunk.meta,
            embedding: chunk.embedding,
          })),
        );
      }
    });

    console.log(`Seeded ${embeddedFiles.length} files and ${embeddedFiles.reduce((sum, file) => sum + file.chunks.length, 0)} chunks.`);
    console.log(`Login: ${email} / ${password}`);
    console.log(`Knowledge base id: ${DEMO_KNOWLEDGE_BASE_ID}`);
    console.log('Re-running this command replaces only this demo account and leaves all other data untouched.');
  } finally {
    await pgModule.closePool();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
