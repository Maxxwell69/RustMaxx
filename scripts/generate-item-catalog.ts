/**
 * Generate lib/item-catalog-generated.ts from the community Rust item list (JSON).
 * Run: npx tsx scripts/generate-item-catalog.ts
 * Source: https://github.com/SzyMig/Rust-item-list-JSON
 */

import { writeFileSync } from "fs";
import { join } from "path";

const ITEMS_JSON_URL =
  "https://raw.githubusercontent.com/SzyMig/Rust-item-list-JSON/main/Rust-Items.json";

type ItemCategory =
  | "resources"
  | "components"
  | "electrical"
  | "weapons"
  | "ammo"
  | "medical"
  | "tools"
  | "building"
  | "attachments"
  | "attire"
  | "food"
  | "fun"
  | "traps"
  | "other";

function mapCategory(jsonCategory: string): ItemCategory {
  const c = (jsonCategory || "").toLowerCase();
  if (c === "ammunition") return "ammo";
  if (c === "weapon") return "weapons";
  if (c === "medical") return "medical";
  if (c === "tool") return "tools";
  if (c === "construction") return "building";
  if (c === "component") return "components";
  if (c === "electrical") return "electrical";
  if (c === "food") return "food";
  if (c === "attire") return "attire";
  if (c === "resources") return "resources";
  if (c === "attachment" || c === "attachments") return "attachments";
  if (c === "fun") return "fun";
  if (c === "traps") return "traps";
  if (c === "items" || c === "misc") return "other";
  return "other";
}

type JsonItem = {
  shortname?: string;
  Name?: string;
  Category?: string;
  stackable?: number;
};

async function main() {
  console.log("Fetching Rust-Items.json...");
  const res = await fetch(ITEMS_JSON_URL);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const raw = await res.text();
  const items: JsonItem[] = JSON.parse(raw);

  const seen = new Set<string>();
  const entries: string[] = [];
  let count = 0;

  for (const item of items) {
    const shortname = typeof item.shortname === "string" ? item.shortname.trim() : "";
    const name = typeof item.Name === "string" ? item.Name.trim() : "";
    if (!shortname || !name) continue;
    if (seen.has(shortname)) continue;
    seen.add(shortname);
    let category = mapCategory(item.Category ?? "");
    // JSON has no "Attachment" category; weapon mods (scopes, silencers, etc.) are under Weapon — re-categorize
    if (shortname.startsWith("weapon.mod.")) category = "attachments";
    const amount = typeof item.stackable === "number" && item.stackable > 0 ? item.stackable : 1;
    const amountClamped = Math.min(999999, Math.max(1, amount));
    const nameEscaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    entries.push(
      `  { shortname: ${JSON.stringify(shortname)}, label: ${JSON.stringify(name)}, amount: ${amountClamped}, category: "${category}" }`
    );
    count++;
  }

  const header = `export type ItemCategory =
  | "resources"
  | "components"
  | "electrical"
  | "weapons"
  | "ammo"
  | "medical"
  | "tools"
  | "building"
  | "attachments"
  | "attire"
  | "food"
  | "fun"
  | "traps"
  | "other";

export type ItemDefinition = {
  shortname: string;
  label: string;
  amount: number;
  category: ItemCategory;
};

// Generated from Rust-Items.json (https://github.com/SzyMig/Rust-item-list-JSON). Regenerate: npx tsx scripts/generate-item-catalog.ts
export const ITEM_CATALOG: ItemDefinition[] = [
`;
  const footer = "\n];\n";
  const out = header + entries.join(",\n") + footer;

  const outPath = join(process.cwd(), "lib", "item-catalog.ts");
  writeFileSync(outPath, out, "utf8");
  console.log(`Wrote ${count} items to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
