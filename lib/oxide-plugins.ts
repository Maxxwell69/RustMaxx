export type PluginEntry = {
  name: string;
  version: string;
  author: string;
  hookTime: string;
  filename: string;
};

/** Parse Oxide "oxide.plugins" output into structured list. Tries multiple formats. */
export function parseOxidePluginsOutput(raw: string): {
  plugins: PluginEntry[];
  failed: string[];
} {
  const plugins: PluginEntry[] = [];
  const failed: string[] = [];
  const lines = raw.split(/\r?\n/);

  const fullRe =
    /^\s*\d+\s+"([^"]+)"\s*\(([^)]+)\)\s+by\s+(.+?)\s+\(([\d.]+)\s*s\)\s+-\s+(.+)$/i;
  const withHookRe =
    /^\s*\d+\s+"([^"]+)"\s*\(([^)]+)\)\s+by\s+(.+?)\s+\(([\d.]+)\s*s?\)\s+-\s+(.+)$/i;
  const noAuthorRe = /^\s*\d+\s+"([^"]+)"\s*\(([^)]+)\)\s+-\s+(.+)$/;
  const minimalRe = /^\s*\d+\s+"([^"]+)"\s*\(([^)]+)\)\s+.+?-\s+(.+)$/;
  const withPrefixRe =
    /^\s*.+?\s+(\d+)\s+"([^"]+)"\s*\(([^)]+)\)\s+(?:by\s+(.+?)\s+)?\(?([\d.]+)\s*s?\)?\s+-\s+(.+)$/i;
  const withPrefixNoHookRe = /^\s*.+?\s+(\d+)\s+"([^"]+)"\s*\(([^)]+)\)\s+-\s+(.+)$/;
  const fallbackRe = /^\s*\d+\s+"([^"]+)"\s*\(([^)]+)\)\s+.+-\s+(\S+\.(cs|cs\.disabled))$/i;
  const looseRe = /"([^"]+)"\s*\(([^)]+)\)\s+.+-\s+(\S+\.(?:cs|cs\.disabled))$/i;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("Listing ") || t === "No plugins loaded") continue;

    let m = t.match(fullRe) ?? t.match(withHookRe);
    if (m) {
      plugins.push({
        name: m[1]!.trim(),
        version: m[2]!.trim(),
        author: (m[3] ?? "").trim(),
        hookTime: (m[4] ?? "").trim(),
        filename: m[5]!.trim(),
      });
      continue;
    }
    m = t.match(noAuthorRe);
    if (m) {
      plugins.push({
        name: m[1]!.trim(),
        version: m[2]!.trim(),
        author: "",
        hookTime: "",
        filename: m[3]!.trim(),
      });
      continue;
    }
    m = t.match(minimalRe);
    if (m) {
      plugins.push({
        name: m[1]!.trim(),
        version: m[2]!.trim(),
        author: "",
        hookTime: "",
        filename: m[3]!.trim(),
      });
      continue;
    }
    m = t.match(withPrefixRe);
    if (m) {
      plugins.push({
        name: m[2]!.trim(),
        version: m[3]!.trim(),
        author: (m[4] ?? "").trim(),
        hookTime: (m[5] ?? "").trim(),
        filename: m[6]!.trim(),
      });
      continue;
    }
    m = t.match(withPrefixNoHookRe);
    if (m) {
      plugins.push({
        name: m[2]!.trim(),
        version: m[3]!.trim(),
        author: "",
        hookTime: "",
        filename: m[4]!.trim(),
      });
      continue;
    }
    m = t.match(fallbackRe);
    if (m) {
      plugins.push({
        name: m[1]!.trim(),
        version: m[2]!.trim(),
        author: "",
        hookTime: "",
        filename: m[3]!.trim(),
      });
      continue;
    }
    m = t.match(looseRe);
    if (m) {
      plugins.push({
        name: m[1]!.trim(),
        version: m[2]!.trim(),
        author: "",
        hookTime: "",
        filename: m[3]!.trim(),
      });
      continue;
    }
    if (t) failed.push(t);
  }
  return { plugins, failed };
}

/** Slug from plugin filename for URL (filename without .cs). */
export function pluginSlugFromFilename(filename: string): string {
  return filename.replace(/\.(cs|cs\.disabled)$/i, "").trim();
}

/** Parse "oxide.show perms" output into list of permission strings. */
export function parseOxidePermsOutput(raw: string): string[] {
  const out: string[] = [];
  const normalized = raw.replace(/\r\n/g, "\n").replace(/,/g, "\n");
  for (const line of normalized.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes(".") && /^[a-z0-9_.]+$/i.test(t)) {
      out.push(t);
    }
  }
  return [...new Set(out)];
}

/** Filter permissions that likely belong to this plugin (by filename and optionally display name). */
export function permissionsForPlugin(
  permissions: string[],
  filename: string,
  displayName?: string
): string[] {
  const fromFile = pluginSlugFromFilename(filename).toLowerCase().replace(/\s+/g, "");
  const prefixes = [fromFile + "."];
  if (displayName) {
    const fromName = displayName.toLowerCase().replace(/\s+/g, "");
    if (fromName !== fromFile) prefixes.push(fromName + ".");
  }
  return permissions.filter((p) => {
    const lower = p.toLowerCase();
    return prefixes.some((prefix) => lower.startsWith(prefix));
  });
}
