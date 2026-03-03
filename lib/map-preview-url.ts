/**
 * Build map preview URL from seed + world size + level.
 * MAP_PREVIEW_PROVIDER=playrust (default) | rustmaps | custom
 * PlayRust.io URLs are map viewer pages (use iframe). For custom image URLs use MAP_PREVIEW_URL_TEMPLATE.
 */

const PROVIDER = process.env.MAP_PREVIEW_PROVIDER ?? "playrust";
const CUSTOM_TEMPLATE = process.env.MAP_PREVIEW_URL_TEMPLATE ?? "";

/**
 * PlayRust.io map viewer: /map/?Procedural+Map_{worldSize}_{seed}=
 * This is an HTML page; embed with iframe, not img.
 */
function playrustUrl(seed: number, worldSize: number, level: string | null): string {
  const levelPart = (level || "Procedural").replace(/\s+/g, "+");
  return `https://playrust.io/map/?${levelPart}+Map_${worldSize}_${seed}=`;
}

/**
 * RustMaps.com – gallery/search style; may not have a direct embed URL.
 */
function rustmapsUrl(seed: number, worldSize: number, _level: string | null): string {
  return `https://rustmaps.com/map/${worldSize}_${seed}`;
}

export function buildMapPreviewUrl(
  seed: number | null,
  worldSize: number | null,
  level: string | null
): string | null {
  if (seed == null || worldSize == null) return null;
  const s = Number(seed);
  const w = Number(worldSize);
  if (!Number.isInteger(s) || !Number.isInteger(w) || w < 1000 || w > 6000) return null;

  if (PROVIDER === "custom" && CUSTOM_TEMPLATE) {
    return CUSTOM_TEMPLATE.replace("{seed}", String(s))
      .replace("{size}", String(w))
      .replace("{worldSize}", String(w))
      .replace("{level}", (level || "procedural").trim());
  }

  if (PROVIDER === "rustmaps") return rustmapsUrl(s, w, level);
  return playrustUrl(s, w, level);
}

/** True if the URL is a map viewer page (embed in iframe), not a direct image. */
export function isMapViewerUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === "playrust.io" || u.hostname === "www.playrust.io";
  } catch {
    return false;
  }
}
