import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

const pool =
  typeof connectionString === "string" && connectionString.length > 0
    ? new Pool({ connectionString })
    : null;

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  if (!pool) throw new Error("DATABASE_URL is not set");
  const result = await pool.query(text, params);
  return { rows: (result.rows as T[]) || [], rowCount: result.rowCount ?? 0 };
}

export { pool };

export type ServerRow = {
  id: string;
  name: string;
  rcon_host: string;
  rcon_port: number;
  rcon_password: string;
  created_at: Date;
};

export type LogRow = {
  id: string;
  server_id: string;
  type: string;
  message: string;
  created_at: Date;
};
