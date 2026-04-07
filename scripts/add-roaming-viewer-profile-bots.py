"""One-time helper: clone bunny1 Roaming preset to gingy / egg / vamp. Re-run only if resetting from bunny1."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "plugins" / "RoamingNpc" / "config" / "RoamingNPCs.json"


def item_entry(shortname: str) -> dict:
    return {
        "Item shortname or ID": shortname,
        "Item name (leave empty for default)": "",
        "Item skin": 0,
        "Enable chance of drop on death?": False,
        "Chance of drop on death (0-100)": 100,
        "Attachments": [],
    }


def fight_item(shortname: str, ammo: str = "") -> dict:
    return {
        "Allow to create item if it is not in inventory?": True,
        "Allow to give item when respawning?": True,
        "Item": item_entry(shortname),
        "Ammo shortname for weapon (leave empty to keep default)": ammo,
    }


def reorder_mining(bot: dict, priority: list[str]) -> None:
    om = bot["Items for ore mining"]["List of items (in priority order)"]
    by_short = {it["Item"]["Item shortname or ID"]: it for it in om}
    bot["Items for ore mining"]["List of items (in priority order)"] = [
        by_short[s] for s in priority if s in by_short
    ]


def reorder_tree(bot: dict, priority: list[str]) -> None:
    tg = bot["Items for tree gathering"]["List of items (in priority order)"]
    by_short = {it["Item"]["Item shortname or ID"]: it for it in tg}
    bot["Items for tree gathering"]["List of items (in priority order)"] = [
        by_short[s] for s in priority if s in by_short
    ]


def main() -> None:
    data = json.loads(P.read_text(encoding="utf-8"))
    bots = data["Bots settings"]
    if "bunny1" not in bots:
        raise SystemExit("RoamingNPCs.json missing Bots settings.bunny1")
    base = copy.deepcopy(bots["bunny1"])

    gingy = copy.deepcopy(base)
    gingy["Bot name (leave empty for random)"] = "Gingy"
    gingy["Wear items (on respawn)"]["List of items"] = [item_entry("gingerbreadsuit")]
    gingy["Items for fights"]["Use ammo?"] = True
    gingy["Items for fights"]["List of items (in priority order)"] = [
        fight_item("rifle.ak", "ammo.rifle"),
    ]
    gingy["Items for fights"]["Amount of ammo to give for weapon if respawning is allowed"] = 128
    reorder_mining(
        gingy,
        ["jackhammer", "pickaxe", "lumberjack.pickaxe", "diverpickaxe", "stone.pickaxe", "rock"],
    )
    reorder_tree(
        gingy,
        [
            "lumberjack.hatchet",
            "hatchet",
            "chainsaw",
            "frontier_hatchet",
            "stonehatchet",
            "rock",
        ],
    )
    bots["gingy"] = gingy

    egg = copy.deepcopy(base)
    egg["Bot name (leave empty for random)"] = "Egg"
    egg["Wear items (on respawn)"]["List of items"] = [item_entry("attire.egg.suit")]
    egg["Resource collection"]["Allow to use fuel for chainsaw?"] = True
    egg["Items for fights"]["Use ammo?"] = True
    egg["Items for fights"]["List of items (in priority order)"] = [
        fight_item("rifle.lr300", "ammo.rifle"),
    ]
    egg["Items for fights"]["Amount of ammo to give for weapon if respawning is allowed"] = 128
    reorder_tree(
        egg,
        ["chainsaw", "lumberjack.hatchet", "hatchet", "frontier_hatchet", "stonehatchet", "rock"],
    )
    bots["egg"] = egg

    vamp = copy.deepcopy(base)
    vamp["Bot name (leave empty for random)"] = "Vamp"
    vamp["Wear items (on respawn)"]["List of items"] = [
        item_entry("draculacape"),
        item_entry("draculamask"),
        item_entry("pants"),
    ]
    vamp["Items for fights"]["Use ammo?"] = True
    vamp["Items for fights"]["List of items (in priority order)"] = [
        fight_item("bow.hunting", "arrow.wooden"),
        fight_item("mace.baseballbat", ""),
    ]
    vamp["Items for fights"]["Amount of ammo to give for weapon if respawning is allowed"] = 64
    bots["vamp"] = vamp

    P.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Wrote Bots settings: gingy, egg, vamp")


if __name__ == "__main__":
    main()
