import type { TikTriggerAction } from "@/lib/tikfinity";

/** Curated RustChaos spawns for streamer rules (TikFinity event name = rule name by default). */
export type StreamerSpawnPreset = {
  serverAction: TikTriggerAction;
  /** Default rule / TikFinity event name (case-insensitive match in webhook). */
  ruleName: string;
  label: string;
  description: string;
};

export const STREAMER_SPAWN_PRESETS: StreamerSpawnPreset[] = [
  {
    serverAction: "bear",
    ruleName: "bear",
    label: "Spawn bear",
    description: "Spawns a bear near the streamer (land).",
  },
  {
    serverAction: "wolf",
    ruleName: "wolf",
    label: "Spawn wolf",
    description: "Spawns a wolf near the streamer.",
  },
  {
    serverAction: "scientist",
    ruleName: "scientist",
    label: "Spawn scientist",
    description: "Spawns one scientist behind the streamer.",
  },
];
