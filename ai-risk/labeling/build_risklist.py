import json
import os
from pathlib import Path

# ========= 你可以在这里添加本地手动标注地址 =========
LOCAL_BLACKLIST = [
    "0x000000000000000000000000000000000000dead",
    "0x1111111111111111111111111111111111111111",
]

LOCAL_WHITELIST = [
    "0x0000000000000000000000000000000000000001",
]

POISON_RISK_POOL = Path("../data/poison_hunter_for_risklist.json")

def normalize(addr: str):
    return addr.lower()

def load_poison_pool():
    if not POISON_RISK_POOL.exists():
        return []
    obj = json.loads(POISON_RISK_POOL.read_text(encoding="utf-8"))
    return [normalize(a) for a in obj.get("addresses", [])]

def build_risklist():
    risk_data = {"blacklist": [], "whitelist": []}

    # 本地标注
    risk_data["blacklist"].extend([normalize(a) for a in LOCAL_BLACKLIST])
    risk_data["whitelist"].extend([normalize(a) for a in LOCAL_WHITELIST])

    # Poison-Hunter pool（高置信度恶意地址）
    risk_data["blacklist"].extend(load_poison_pool())

    # 去重
    risk_data["blacklist"] = sorted(set(risk_data["blacklist"]))
    risk_data["whitelist"] = sorted(set(risk_data["whitelist"]))

    return risk_data

if __name__ == "__main__":
    risklist = build_risklist()
    os.makedirs("../data", exist_ok=True)

    out = Path("../data/Risklist.json")
    out.write_text(json.dumps(risklist, indent=2), encoding="utf-8")

    print("Risklist.json generated.")
    print("Blacklist size:", len(risklist["blacklist"]))
    print("Whitelist size:", len(risklist["whitelist"]))
    print("Wrote:", out)
