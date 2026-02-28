import { query } from "./db";

export async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await query(
    "INSERT INTO audit (actor, action, payload) VALUES ($1, $2, $3)",
    [actor, action, JSON.stringify(payload)]
  );
}
