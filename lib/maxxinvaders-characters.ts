/**
 * Marketing copy for /maxxinvaders — RoamingNPCs template keys & TikFinity outfits.
 * Images live under public/maxxinvaders/ — set imageSrc to `/maxxinvaders/<file>.png` etc.
 * Target export size for hero art: **504×750 px** (portrait); cards use that aspect ratio.
 */

export type MaxxInvaderTier = "main" | "special";

export type MaxxInvaderCharacter = {
  slug: string;
  displayName: string;
  tier: MaxxInvaderTier;
  /** Public URL e.g. `/maxxinvaders/miner.png` */
  imageSrc?: string;
  /** Chat command (e.g. `!miner`) shown under the character name */
  chatCommand: string;
  loadout: string[];
  /** Short gameplay / stream role */
  role: string;
};

export const MAXXINVADER_MAIN_CHARACTERS: MaxxInvaderCharacter[] = [
  {
    slug: "miner",
    displayName: "Miner",
    tier: "main",
    imageSrc: "/maxxinvaders/miner.png",
    chatCommand: "!miner",
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
    chatCommand: "!snipemb",
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
    chatCommand: "!medic",
    loadout: ["Scrubs / surgeon suit", "Revolver", "Syringes & large medkits"],
    role:
      "Field medic for the streamer: revives and heals the anchor, stays in escort range, and keeps the squad on its feet.",
  },
  {
    slug: "lumberjack",
    displayName: "Lumberjack",
    tier: "main",
    imageSrc: "/maxxinvaders/lumberjack.png",
    chatCommand: "!jack",
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
    chatCommand: "!gingy",
    loadout: ["Gingerbread suit", "Loadout from Roaming `gingy` template (e.g. AK, tools, meds)"],
    role: "Seasonal / fun spawn: full kit from the `gingy` Roaming template; great for holiday raids and memes.",
  },
  {
    slug: "vamp",
    displayName: "Vamp",
    tier: "special",
    imageSrc: "/maxxinvaders/vamp.png",
    chatCommand: "!vamp",
    loadout: ["Dracula cape & mask", "Bow, bat, meds per `vamp` template"],
    role: "Gothic event look: use the `vamp` template for a themed loadout tied to TikFinity or manual spawns.",
  },
  {
    slug: "egg-man",
    displayName: "Egg Man",
    tier: "special",
    imageSrc: "/maxxinvaders/eggman.png",
    chatCommand: "!eggman",
    loadout: ["Egg suit", "LR / chainsaw / meds per `egg` Roaming template"],
    role: "Egg suit chaos: spawn with the `egg` preset when you want silly, high-energy viewer moments.",
  },
  {
    slug: "bunny",
    displayName: "Bunny",
    tier: "special",
    imageSrc: "/maxxinvaders/bunny.png",
    chatCommand: "!bunny",
    loadout: ["Bunny onesie & ears", "Weapons & gear from patrol template + bunny wear"],
    role:
      "Cute infiltration: bunny outfit overlay on MaxxInvaders—perfect for spring events or gift-driven redeploys.",
  },
];
