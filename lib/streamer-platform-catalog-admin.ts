import { ACTION_META, type TikTriggerAction } from "@/lib/tikfinity";
import {
  STREAMER_BASE_ACTION_KEYS,
  isBaseStreamerAction,
} from "@/lib/streamer-action-policy";

export type AdminStreamerCatalogRow = {
  action_key: string;
  is_active: boolean;
  label: string | null;
  /** Present in `streamer_platform_action_catalog` (false until first PATCH or sync). */
  registered: boolean;
};

export function labelForStreamerCatalogKey(key: string): string {
  if (isBaseStreamerAction(key)) {
    const meta = ACTION_META[key as TikTriggerAction];
    if (meta?.label) return meta.label;
  }
  return key;
}

/**
 * One row per streamer-allowable action from code, merged with DB catalog (is_active + custom labels).
 */
export function mergeStreamerCatalogWithCodebase(
  dbRows: { action_key: string; is_active: boolean; label: string | null }[]
): AdminStreamerCatalogRow[] {
  const map = new Map(dbRows.map((r) => [r.action_key, r]));
  return STREAMER_BASE_ACTION_KEYS.map((key) => {
    const row = map.get(key);
    const fallbackLabel = labelForStreamerCatalogKey(key);
    return {
      action_key: key,
      is_active: row?.is_active ?? false,
      label: row?.label?.trim() ? row.label : fallbackLabel,
      registered: row != null,
    };
  });
}
