import "dotenv/config";
import { query } from "../lib/db";

const EMAIL = "williskemp@rustmaxx.com";
const NEW_ROLE = "guest";

async function demote() {
  const { rowCount } = await query(
    "UPDATE users SET role = $1, updated_at = now() WHERE lower(email) = lower($2)",
    [NEW_ROLE, EMAIL]
  );
  if (rowCount === 0) {
    console.log(`No user found with email ${EMAIL}.`);
  } else {
    console.log(`${EMAIL} role set to ${NEW_ROLE}.`);
  }
}

demote().catch((err) => {
  console.error(err);
  process.exit(1);
});
