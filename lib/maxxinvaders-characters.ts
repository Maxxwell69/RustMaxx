/**
 * Marketing copy for /maxxinvaders — RoamingNPCs template keys & TikFinity outfits.
 * Images live under public/maxxinvaders/ — set imageSrc to `/maxxinvaders/<file>.png` etc.
 */

export type MaxxInvaderTier = "main" | "special";

export type MaxxInvaderCharacter = {
  slug: string;
  displayName: string;
  tier: MaxxInvaderTier;
  /** Public URL e.g. `/maxxinvaders/miner.png` */
  imageSrc?: string;
  /** Roaming bot key or outfit id for streamers */
  templateOrOutfit: string;
  loadout: string[];
  /** Short gameplay / stream role */
  role: string;
};

/** Repository docs — full plugin behaviour, install, config */
export const MAXXINVADERS_PLUGIN_DOC_HREF =
  "https://github.com/Maxxwell69/RustMaxx/blob/main/docs/MAXXINVADERS.md";

export const MAXXINVADERS_PLUGIN_README_HREF =
  "https://github.com/Maxxwell69/RustMaxx/blob/main/plugins/MaxxInvaders/README.md";

export const MAXXINVADER_MAIN_CHARACTERS: MaxxInvaderCharacter[] = [
  {
    slug: "miner",
    displayName: "Miner",
    tier: "main",
    imageSrc: "/maxxinvaders/miner.png",
    templateOrOutfit: "streamer_miner",
    loadout: [
      "Kick hazmat",
      "Large backpack",
      "Jackhammer & pickaxe (ore)",
      "Revolver",
    ],
    role:
      "Ore and stone farmer for your chat: anchors near you on the stream patrol, gathers metal/sulfur/stone faster, and bags loot for deposit.",
  },
  {
    slug: "sniper",
    displayName: "Sniper",
    tier: "main",
    imageSrc: "/maxxinvaders/sniper.png",
    templateOrOutfit: "streamer_patrol",
    loadout: [
      "Patrol / hunter kit from template (rifle-focused)",
      "Med slots & melee backup per Roaming template",
    ],
    role:
      "Default MaxxInvaders bodyguard: follows your anchor, protects you from players and threats, and holds ground around stream.",
  },
  {
    slug: "medic",
    displayName: "Medic",
    tier: "main",
    imageSrc: "/maxxinvaders/medic.png",
    templateOrOutfit: "streamer_medic",
    loadout: ["Scrubs / surgeon suit", "Revolver", "Syringes & large medkits"],
    role:
      "Field medic for the streamer: revives and heals the anchor, stays in escort range, and keeps the squad on its feet.",
  },
  {
    slug: "lumberjack",
    displayName: "Lumberjack",
    tier: "main",
    imageSrc: "/maxxinvaders/lumberjack.png",
    templateOrOutfit: "streamer_lumberjack",
    loadout: ["Lumberjack hazmat", "Chainsaw + low grade", "Hatchet backup"],
    role:
      "Wood specialist: fast tree work for events, same MaxxInvaders bridge (tasks, escort, storage) as the rest of the crew.",
  },
];

export const MAXXINVADER_SPECIAL_CHARACTERS: MaxxInvaderCharacter[] = [
  {
    slug: "gingy",
    displayName: "Gingy",
    tier: "special",
    imageSrc: "/maxxinvaders/gingy.png",
    templateOrOutfit: "gingy (template) / ?outfit=gingy / gingynpc",
    loadout: ["Gingerbread suit", "Loadout from Roaming `gingy` template (e.g. AK, tools, meds)"],
    role: "Seasonal / fun spawn: full kit from the `gingy` Roaming template; great for holiday raids and memes.",
  },
  {
    slug: "vamp",
    displayName: "Vamp",
    tier: "special",
    imageSrc: "/maxxinvaders/vamp.png",
    templateOrOutfit: "vamp (template) / ?outfit=vamp / vampnpc",
    loadout: ["Dracula cape & mask", "Bow, bat, meds per `vamp` template"],
    role: "Gothic event look: use the `vamp` template for a themed loadout tied to TikFinity or manual spawns.",
  },
  {
    slug: "egg-man",
    displayName: "Egg Man",
    tier: "special",
    imageSrc: "/maxxinvaders/eggman.png",
    templateOrOutfit: "egg (template) / ?outfit=egg / eggnpc",
    loadout: ["Egg suit", "LR / chainsaw / meds per `egg` Roaming template"],
    role: "Egg suit chaos: spawn with the `egg` preset when you want silly, high-energy viewer moments.",
  },
  {
    slug: "bunny",
    displayName: "Bunny",
    tier: "special",
    imageSrc: "/maxxinvaders/bunny.png",
    templateOrOutfit: "bunny1 / ?outfit=bunny1 / bunny1npc",
    loadout: ["Bunny onesie & ears", "Weapons & gear from patrol template + bunny wear"],
    role:
      "Cute infiltration: bunny outfit overlay on MaxxInvaders—perfect for spring events or gift-driven redeploys.",
  },
];
