import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as evalSchema from './schema/eval';
import * as coreSchema from './schema/core';

const schema = { ...coreSchema, ...evalSchema };

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

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
