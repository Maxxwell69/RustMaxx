/**
 * One-off script: make black background of public/rustmaxx-logo.png transparent.
 * Run: node scripts/make-logo-transparent.mjs
 */
import sharp from "sharp";
import { renameSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inputPath = join(root, "public", "rustmaxx-logo.png");
const tempPath = join(root, "public", "rustmaxx-logo-transparent.png");

const BLACK_THRESHOLD = 28; // pixels with r,g,b all below this become transparent

async function main() {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD) {
      data[i + 3] = 0;
    }
  }

  await sharp(data, { raw: { width, height, channels } })
    .png()
    .toFile(tempPath);

  if (existsSync(inputPath)) unlinkSync(inputPath);
  renameSync(tempPath, inputPath);
  console.log("Logo background made transparent:", inputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
