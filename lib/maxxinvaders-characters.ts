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
  /** Optional line shown below `role` (e.g. tribute), styled as green highlight in the card */
  roleTribute?: string;
  /** If set, `roleTribute` becomes a link (e.g. TikTok shout-out) */
  roleTributeHref?: string;
};

export const MAXXINVADER_MAIN_CHARACTERS: MaxxInvaderCharacter[] = [
  {
    slug: "miner",
    displayName: "⛏️ Miner",
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
      "Smashes nodes and barrels nonstop—if there's loot nearby, he's already digging it up.",
  },
  {
    slug: "sniper",
    displayName: "🎯 Snipe My Burger",
    tier: "main",
    imageSrc: "/maxxinvaders/sniper.png",
    chatCommand: "!snipemb",
    loadout: [
      "Patrol / hunter kit from template (rifle-focused)",
      "Med slots & melee backup per Roaming template",
    ],
    role:
      "Long range menace who never misses a shot—if you stand still, you're already dead.",
    roleTribute: "Snipe My Burger tribute.",
    roleTributeHref: "https://www.tiktok.com/@snipemyburger",
  },
  {
    slug: "medic",
    displayName: "🩺 Medic",
    tier: "main",
    /** Bump `?v=` when replacing the PNG so CDN / Next Image invalidate cached bytes. */
    imageSrc: "/maxxinvaders/medic.png?v=20260420",
    chatCommand: "!medic",
    loadout: ["Scrubs / surgeon suit", "Revolver", "Syringes & large medkits"],
    role:
      "Keeps allies alive… and enemies suffering—heals fast, poisons faster.",
    roleTribute: "Yomamma Pick tribute.",
    roleTributeHref: "https://www.tiktok.com/@yomamapicks",
  },
  {
    slug: "lumberjack",
    displayName: "🪓 Jack",
    tier: "main",
    imageSrc: "/maxxinvaders/lumberjack.png",
    chatCommand: "!jack",
    loadout: ["Lumberjack hazmat", "Chainsaw + low grade", "Hatchet backup"],
    role:
      "Tree destroyer with zero remorse—chainsaw screaming, forests disappearing.",
  },
];

export const MAXXINVADER_SPECIAL_CHARACTERS: MaxxInvaderCharacter[] = [
  {
    slug: "gingy",
    displayName: "🍪 Gingy (Special Event)",
    tier: "special",
    imageSrc: "/maxxinvaders/gingy.png",
    chatCommand: "!gingy",
    loadout: ["Gingerbread suit", "Loadout from Roaming `gingy` template (e.g. AK, tools, meds)"],
    role:
      "Sweet on the outside, pure chaos inside—this cookie snaps and goes straight for blood.",
  },
  {
    slug: "vamp",
    displayName: "🧛 Vamp",
    tier: "special",
    imageSrc: "/maxxinvaders/vamp.png",
    chatCommand: "!vamp",
    loadout: ["Dracula cape & mask", "Bow, bat, meds per `vamp` template"],
    role:
      "Hunts by night, stakes by day—turns wood into weapons and pigs into problems.",
  },
  {
    slug: "egg-man",
    displayName: "🥚 Eggman",
    tier: "special",
    imageSrc: "/maxxinvaders/eggman.png",
    chatCommand: "!eggman",
    loadout: ["Egg suit", "LR / chainsaw / meds per `egg` Roaming template"],
    role:
      "Loot goblin in disguise—drops hit the ground and vanish before you can blink.",
  },
  {
    slug: "bunny",
    displayName: "🐰 Bunny",
    tier: "special",
    imageSrc: "/maxxinvaders/bunny.png",
    chatCommand: "!bunny",
    loadout: ["Bunny onesie & ears", "Weapons & gear from patrol template + bunny wear"],
    role:
      "Scrap hoarder with a nose for profit—if it's on the ground, it's already his.",
  },
];
