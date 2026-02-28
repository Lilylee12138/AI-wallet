import json
from pathlib import Path

OLD_RISKLIST = Path("data/Risklist.json")
POISON_RISK_POOL = Path("data/poison_hunter_for_risklist.json")

OUT = Path("data/Risklist.tagged.json")

def norm(a: str) -> str:
    return a.lower()

def load_list_if_exists(path: Path):
    if not path.exists():
        return []
    obj = json.loads(path.read_text(encoding="utf-8"))
    # poison pool 格式: {"seed":..., "addresses":[...]}
    if isinstance(obj, dict) and "addresses" in obj:
        return [norm(x) for x in obj["addresses"] if isinstance(x, str)]
    # old risklist 格式: {"blacklist":[...], "whitelist":[...]}
    if isinstance(obj, dict) and any(k in obj for k in ["blacklist", "whitelist"]):
        out = []
        for k in ["blacklist", "whitelist"]:
            if isinstance(obj.get(k), list):
                out.extend([norm(x) for x in obj[k] if isinstance(x, str)])
        return out
    return []

def main():
    old = json.loads(OLD_RISKLIST.read_text(encoding="utf-8"))

    old_bl = [norm(x) for x in old.get("blacklist", [])] if isinstance(old.get("blacklist"), list) else []
    old_wl = [norm(x) for x in old.get("whitelist", [])] if isinstance(old.get("whitelist"), list) else []

    # 新结构：地址 -> meta
    tagged = {"blacklist": {}, "whitelist": {}}

    # 1) 旧 black/white 先作为 manual 导入（你原来手工标的）
    for a in old_bl:
        tagged["blacklist"][a] = {"source": "manual", "tag": "manual"}
    for a in old_wl:
        tagged["whitelist"][a] = {"source": "manual", "tag": "manual"}

    # 2) Poison-Hunter risklist pool：标为 phishing
    if POISON_RISK_POOL.exists():
        pool = json.loads(POISON_RISK_POOL.read_text(encoding="utf-8")).get("addresses", [])
        for a in pool:
            a = norm(a)
            # poison-hunter 覆盖 manual（更具体）
            tagged["blacklist"][a] = {"source": "poison-hunter", "tag": "phishing"}

    # 3) whitelist 优先：如果同一地址同时出现，保留 whitelist
    for a in list(tagged["blacklist"].keys()):
        if a in tagged["whitelist"]:
            del tagged["blacklist"][a]

    OUT.write_text(json.dumps(tagged, indent=2), encoding="utf-8")

    print("Wrote:", OUT)
    print("Blacklist size:", len(tagged["blacklist"]))
    print("Whitelist size:", len(tagged["whitelist"]))

if __name__ == "__main__":
    main()
