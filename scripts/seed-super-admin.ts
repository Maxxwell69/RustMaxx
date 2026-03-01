import "dotenv/config";
import bcrypt from "bcryptjs";
import { query } from "../lib/db";

const SUPER_ADMINS: { email: string; password: string }[] = [
  { email: "maxx@rustmaxx.com", password: "ShogunMaxx1969!" },
  { email: "williskemp@rustmaxx.com", password: "rustmaxx2026!" },
];

const ROLE = "super_admin";

async function seed() {
  for (const { email, password } of SUPER_ADMINS) {
    const hash = await bcrypt.hash(password, 10);
    await query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         updated_at = now()`,
      [email.toLowerCase(), hash, ROLE]
    );
    console.log(`Super admin ready: ${email}`);
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
