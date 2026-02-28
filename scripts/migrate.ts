import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

const migrationsDir = join(process.cwd(), "db", "migrations");

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    );
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const name = file;
    const { rows } = await pool.query(
      "SELECT 1 FROM _migrations WHERE name = $1",
      [name]
    );
    if (rows.length > 0) {
      console.log("Skip (already applied):", name);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    await pool.query(sql);
    await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
    console.log("Applied:", name);
  }

  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
