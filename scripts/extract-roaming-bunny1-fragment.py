"""Write plugins/RoamingNpc/config/bunny1.merge-fragment.json for pasting bunny1 into a live server config."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "plugins", "RoamingNpc", "config", "RoamingNPCs.json")
OUT = os.path.join(ROOT, "plugins", "RoamingNpc", "config", "bunny1.merge-fragment.json")

def main() -> None:
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    bots = data.get("Bots settings")
    if not isinstance(bots, dict) or "bunny1" not in bots:
        raise SystemExit("RoamingNPCs.json missing Bots settings.bunny1")
    # Valid JSON to paste under "Bots settings": open this file, copy the whole "bunny1" entry (key + object).
    frag = {"bunny1": bots["bunny1"]}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(frag, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("Wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
