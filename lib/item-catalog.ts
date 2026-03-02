export type ItemCategory =
  | "resources"
  | "components"
  | "weapons"
  | "ammo"
  | "medical"
  | "tools"
  | "building"
  | "attachments"
  | "other";

export type ItemDefinition = {
  shortname: string;
  label: string;
  amount: number;
  category: ItemCategory;
};

// Base catalog of items an admin can enable per server for the player page.
export const ITEM_CATALOG: ItemDefinition[] = [
  // Resources
  { shortname: "wood", label: "Wood", amount: 1000, category: "resources" },
  { shortname: "stones", label: "Stones", amount: 1000, category: "resources" },
  { shortname: "metal.ore", label: "Metal Ore", amount: 500, category: "resources" },
  { shortname: "sulfur.ore", label: "Sulfur Ore", amount: 500, category: "resources" },
  { shortname: "metal.fragments", label: "Metal Fragments", amount: 1000, category: "resources" },
  { shortname: "hq.metal.ore", label: "HQ Metal Ore", amount: 500, category: "resources" },
  { shortname: "scrap", label: "Scrap", amount: 100, category: "resources" },
  { shortname: "cloth", label: "Cloth", amount: 100, category: "resources" },
  { shortname: "leather", label: "Leather", amount: 50, category: "resources" },
  { shortname: "fat.animal", label: "Animal Fat", amount: 100, category: "resources" },
  { shortname: "bones", label: "Bones", amount: 50, category: "resources" },
  { shortname: "humanmeat.cooked", label: "Cooked Human Meat", amount: 10, category: "resources" },
  { shortname: "meat.cooked", label: "Cooked Meat", amount: 20, category: "resources" },
  { shortname: "water", label: "Water", amount: 500, category: "resources" },
  { shortname: "can.beans", label: "Can of Beans", amount: 10, category: "resources" },
  { shortname: "can.tuna", label: "Tuna Can", amount: 10, category: "resources" },

  // Components
  { shortname: "gun.powder", label: "Gunpowder", amount: 500, category: "components" },
  { shortname: "gears", label: "Gears", amount: 25, category: "components" },
  { shortname: "metalblade", label: "Metal Blade", amount: 10, category: "components" },
  { shortname: "metalpipe", label: "Metal Pipe", amount: 10, category: "components" },
  { shortname: "sheetmetal", label: "Sheet Metal", amount: 10, category: "components" },
  { shortname: "spring", label: "Spring", amount: 10, category: "components" },
  { shortname: "semibody", label: "Semi Body", amount: 5, category: "components" },
  { shortname: "rifle.body", label: "Rifle Body", amount: 5, category: "components" },
  { shortname: "techparts", label: "Tech Trash", amount: 10, category: "components" },
  { shortname: "electric.switch", label: "Electric Switch", amount: 5, category: "components" },
  { shortname: "electric.andswitch", label: "AND Switch", amount: 5, category: "components" },
  { shortname: "cctv.camera", label: "CCTV Camera", amount: 2, category: "components" },
  { shortname: "targeting.computer", label: "Targeting Computer", amount: 2, category: "components" },

  // Weapons
  { shortname: "rifle.ak", label: "AK-47", amount: 1, category: "weapons" },
  { shortname: "rifle.lr300", label: "LR-300", amount: 1, category: "weapons" },
  { shortname: "rifle.bolt", label: "Bolt Action", amount: 1, category: "weapons" },
  { shortname: "rifle.m39", label: "M39 Rifle", amount: 1, category: "weapons" },
  { shortname: "lmg.m249", label: "M249", amount: 1, category: "weapons" },
  { shortname: "pistol.m92", label: "M92 Pistol", amount: 1, category: "weapons" },
  { shortname: "pistol.revolver", label: "Revolver", amount: 1, category: "weapons" },
  { shortname: "pistol.nailgun", label: "Nailgun", amount: 1, category: "weapons" },
  { shortname: "shotgun.pump", label: "Pump Shotgun", amount: 1, category: "weapons" },
  { shortname: "shotgun.spas12", label: "SPAS-12", amount: 1, category: "weapons" },
  { shortname: "shotgun.double", label: "Double Barrel", amount: 1, category: "weapons" },
  { shortname: "smg.2", label: "Custom SMG", amount: 1, category: "weapons" },
  { shortname: "smg.mp5", label: "MP5A4", amount: 1, category: "weapons" },
  { shortname: "crossbow", label: "Crossbow", amount: 1, category: "weapons" },
  { shortname: "bow.hunting", label: "Hunting Bow", amount: 1, category: "weapons" },
  { shortname: "bow.compound", label: "Compound Bow", amount: 1, category: "weapons" },
  { shortname: "spear.wooden", label: "Wooden Spear", amount: 1, category: "weapons" },
  { shortname: "spear.stone", label: "Stone Spear", amount: 1, category: "weapons" },
  { shortname: "knife.combat", label: "Combat Knife", amount: 1, category: "weapons" },
  { shortname: "knife.bone", label: "Bone Knife", amount: 1, category: "weapons" },
  { shortname: "machete", label: "Machete", amount: 1, category: "weapons" },
  { shortname: "longsword", label: "Longsword", amount: 1, category: "weapons" },
  { shortname: "paddle", label: "Paddle", amount: 1, category: "weapons" },
  { shortname: "eoka.pistol", label: "Eoka Pistol", amount: 1, category: "weapons" },
  { shortname: "pistol.python", label: "Python Revolver", amount: 1, category: "weapons" },
  { shortname: "rifle.assault", label: "Assault Rifle", amount: 1, category: "weapons" },

  // Ammo & Explosives
  { shortname: "ammo.rifle", label: "5.56 Ammo", amount: 128, category: "ammo" },
  { shortname: "ammo.rifle.hv", label: "5.56 HV Ammo", amount: 128, category: "ammo" },
  { shortname: "ammo.rifle.incendiary", label: "5.56 Incendiary", amount: 128, category: "ammo" },
  { shortname: "ammo.pistol", label: "Pistol Ammo", amount: 64, category: "ammo" },
  { shortname: "ammo.pistol.hv", label: "Pistol HV Ammo", amount: 64, category: "ammo" },
  { shortname: "ammo.shotgun", label: "12 Gauge Buckshot", amount: 64, category: "ammo" },
  { shortname: "ammo.shotgun.slug", label: "12 Gauge Slug", amount: 64, category: "ammo" },
  { shortname: "ammo.handmade.shell", label: "Handmade Shell", amount: 64, category: "ammo" },
  { shortname: "arrow.hunting", label: "Arrow", amount: 20, category: "ammo" },
  { shortname: "arrow.wooden", label: "Wooden Arrow", amount: 20, category: "ammo" },
  { shortname: "ammo.rocket.basic", label: "Rocket", amount: 2, category: "ammo" },
  { shortname: "ammo.rocket.hv", label: "HV Rocket", amount: 2, category: "ammo" },
  { shortname: "ammo.rocket.fire", label: "Incendiary Rocket", amount: 2, category: "ammo" },
  { shortname: "explosive.timed", label: "C4", amount: 1, category: "ammo" },
  { shortname: "explosive.satchel", label: "Satchel Charge", amount: 2, category: "ammo" },
  { shortname: "grenade.beancan", label: "Beancan Grenade", amount: 5, category: "ammo" },
  { shortname: "grenade.f1", label: "F1 Grenade", amount: 5, category: "ammo" },
  { shortname: "grenade.smoke", label: "Smoke Grenade", amount: 5, category: "ammo" },
  { shortname: "rocket.basic", label: "Rocket (legacy)", amount: 2, category: "ammo" },

  // Medical
  { shortname: "syringe.medical", label: "Medical Syringe", amount: 5, category: "medical" },
  { shortname: "syringe", label: "Syringe", amount: 5, category: "medical" },
  { shortname: "bandage", label: "Bandage", amount: 10, category: "medical" },
  { shortname: "largemedkit", label: "Large Med Kit", amount: 5, category: "medical" },
  { shortname: "antiradpills", label: "Anti-Rad Pills", amount: 10, category: "medical" },
  { shortname: "painkillers", label: "Pain Killers", amount: 10, category: "medical" },

  // Tools
  { shortname: "hammer", label: "Hammer", amount: 1, category: "tools" },
  { shortname: "hatchet", label: "Hatchet", amount: 1, category: "tools" },
  { shortname: "pickaxe", label: "Pickaxe", amount: 1, category: "tools" },
  { shortname: "torch", label: "Torch", amount: 1, category: "tools" },
  { shortname: "flashlight.held", label: "Flashlight", amount: 1, category: "tools" },
  { shortname: "lantern", label: "Lantern", amount: 1, category: "tools" },
  { shortname: "building.planner", label: "Building Plan", amount: 1, category: "tools" },
  { shortname: "jackhammer", label: "Jackhammer", amount: 1, category: "tools" },
  { shortname: "chainsaw", label: "Chainsaw", amount: 1, category: "tools" },
  { shortname: "salvaged.cleaver", label: "Cleaver", amount: 1, category: "tools" },
  { shortname: "icepick.salvaged", label: "Salvaged Icepick", amount: 1, category: "tools" },

  // Building
  { shortname: "wood.door", label: "Wood Door", amount: 1, category: "building" },
  { shortname: "door.hinged.wood", label: "Wood Door (hinged)", amount: 1, category: "building" },
  { shortname: "door.hinged.metal", label: "Metal Door", amount: 1, category: "building" },
  { shortname: "door.hinged.armored", label: "Armored Door", amount: 1, category: "building" },
  { shortname: "cupboard.tool", label: "Tool Cupboard", amount: 1, category: "building" },
  { shortname: "sleepingbag", label: "Sleeping Bag", amount: 1, category: "building" },
  { shortname: "bed", label: "Bed", amount: 1, category: "building" },
  { shortname: "box.wooden", label: "Wooden Box", amount: 1, category: "building" },
  { shortname: "box.wooden.large", label: "Large Wooden Box", amount: 1, category: "building" },
  { shortname: "keylock", label: "Key Lock", amount: 1, category: "building" },
  { shortname: "lock.code", label: "Code Lock", amount: 1, category: "building" },
  { shortname: "gates.external", label: "Gate", amount: 1, category: "building" },
  { shortname: "wall.frame.cell", label: "Prison Cell Gate", amount: 1, category: "building" },
  { shortname: "ladder.wooden.wall", label: "Ladder", amount: 1, category: "building" },
  { shortname: "floor.ladder.hatch", label: "Ladder Hatch", amount: 1, category: "building" },
  { shortname: "trap.landmine", label: "Landmine", amount: 1, category: "building" },
  { shortname: "trap.beartrap", label: "Bear Trap", amount: 1, category: "building" },
  { shortname: "autoturret", label: "Auto Turret", amount: 1, category: "building" },
  { shortname: "flameturret.deployed", label: "Flame Turret", amount: 1, category: "building" },
  { shortname: "guntrap", label: "Shotgun Trap", amount: 1, category: "building" },

  // Attachments
  { shortname: "weapon.mod.lasersight", label: "Laser Sight", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.flashlight", label: "Weapon Flashlight", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.silencer", label: "Silencer", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.small.scope", label: "4x Scope", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.large.scope", label: "8x Scope", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.holosight", label: "Holosight", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.muzzleboost", label: "Muzzle Boost", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.muzzlebrake", label: "Muzzle Brake", amount: 1, category: "attachments" },
  { shortname: "weapon.mod.burst", label: "Burst Module", amount: 1, category: "attachments" },

  // Other
  { shortname: "keycard_blue", label: "Blue Keycard", amount: 1, category: "other" },
  { shortname: "keycard_red", label: "Red Keycard", amount: 1, category: "other" },
  { shortname: "keycard_green", label: "Green Keycard", amount: 1, category: "other" },
  { shortname: "fuse", label: "Fuse", amount: 5, category: "other" },
  { shortname: "tarp", label: "Tarp", amount: 10, category: "other" },
  { shortname: "rope", label: "Rope", amount: 10, category: "other" },
  { shortname: "glue", label: "Glue", amount: 10, category: "other" },
  { shortname: "sewingkit", label: "Sewing Kit", amount: 5, category: "other" },
  { shortname: "ducttape", label: "Duct Tape", amount: 5, category: "other" },
  { shortname: "bleach", label: "Bleach", amount: 5, category: "other" },
  { shortname: "empty.can", label: "Empty Can", amount: 10, category: "other" },
  { shortname: "empty.propane.tank", label: "Empty Propane Tank", amount: 2, category: "other" },
];
