import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/airag';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
    });
  }
  return pool;
}

export const db = drizzle({ client: getPool(), schema });

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function execute(
  text: string,
  params?: unknown[],
): Promise<number> {
  const result = await getPool().query(text, params);
  return result.rowCount ?? 0;
}


export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
