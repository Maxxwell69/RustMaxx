import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(connectionString: string): Pool {
  if (!connectionString || connectionString.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function query<T = unknown>(
  connectionString: string,
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const p = getPool(connectionString);
  const result = await p.query(text, params);
  return {
    rows: (result.rows as T[]) ?? [],
    rowCount: result.rowCount ?? 0,
  };
}
