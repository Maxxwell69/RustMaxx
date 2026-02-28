import { Pool } from "pg";

/**
 * Delete logs older than 7 days.
 * Run daily via Railway cron or: npm run cleanup
 */
async function cleanup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });

  const result = await pool.query(
    `DELETE FROM logs WHERE created_at < now() - interval '7 days'`
  );
  console.log(`Deleted ${result.rowCount ?? 0} log rows older than 7 days.`);
  await pool.end();
}

cleanup().catch((err) => {
  console.error(err);
  process.exit(1);
});
