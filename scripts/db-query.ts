/**
 * Run SQL against Postgres using DATABASE_URL from .env (same as migrate / app).
 *
 * Reads (default):
 *   npx tsx scripts/db-query.ts "SELECT id, email, role FROM users LIMIT 10"
 *
 * Writes (explicit opt-in — avoids accidental mutations):
 *   npx tsx scripts/db-query.ts --write "UPDATE users SET ..."
 *
 * Requires a local .env with DATABASE_URL (e.g. Railway connect string pasted once).
 * Never commit .env or paste DATABASE_URL into chat.
 */
import "dotenv/config";
import { Pool } from "pg";

function parseArgs(): { sql: string; writeOk: boolean } {
  const raw = process.argv.slice(2);
  let writeOk = false;
  const parts: string[] = [];
  for (const a of raw) {
    if (a === "--write") writeOk = true;
    else parts.push(a);
  }
  return { sql: parts.join(" ").trim(), writeOk };
}

function classify(sql: string): "read" | "write" {
  const s = sql.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "").trimStart();
  const head = s.slice(0, 20).toUpperCase();
  if (
    head.startsWith("INSERT") ||
    head.startsWith("UPDATE") ||
    head.startsWith("DELETE") ||
    head.startsWith("DROP") ||
    head.startsWith("ALTER") ||
    head.startsWith("TRUNCATE") ||
    head.startsWith("CREATE") ||
    head.startsWith("GRANT") ||
    head.startsWith("REVOKE")
  ) {
    return "write";
  }
  return "read";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env in the project root (e.g. copy from Railway Variables).");
    process.exit(1);
  }

  const { sql, writeOk } = parseArgs();
  if (!sql) {
    console.error("Usage:");
    console.error('  npx tsx scripts/db-query.ts "SELECT ..."');
    console.error('  npx tsx scripts/db-query.ts --write "UPDATE ..."');
    process.exit(1);
  }

  const kind = classify(sql);
  if (kind === "write" && !writeOk) {
    console.error(
      "That SQL looks like a write. Re-run with --write if you intend to change data:\n" +
        '  npx tsx scripts/db-query.ts --write "...'
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const result = await pool.query(sql);
    if (result.rows && result.rows.length >= 0) {
      console.log(JSON.stringify(result.rows, replacer, 2));
      console.error(`(${result.rowCount ?? 0} row(s))`);
    }
  } finally {
    await pool.end();
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
