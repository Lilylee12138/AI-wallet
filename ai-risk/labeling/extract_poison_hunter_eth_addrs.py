import os, re, json, random
from pathlib import Path

RE_ADDR = re.compile(r"0x[a-fA-F0-9]{40}")
SEED = 42
random.seed(SEED)

# 你可以按需要调整：只抓“看起来更像恶意”的文件路径关键词（降低噪声）
INCLUDE_HINTS = [
    "phish", "scam", "mal", "attack", "poison", "fraud", "black", "label", "illicit"
]
EXCLUDE_HINTS = [
    "benign", "white", "normal", "good"
]

def looks_relevant(path_str: str) -> bool:
    s = path_str.lower()
    # 如果你想“全仓库都抓”，直接 return True
    hit_in = any(h in s for h in INCLUDE_HINTS)
    hit_ex = any(h in s for h in EXCLUDE_HINTS)
    return hit_in and not hit_ex

def extract_from_text(blob: str):
    return [a.lower() for a in RE_ADDR.findall(blob)]

def read_small_text(fp: Path, max_bytes=3_000_000):
    try:
        data = fp.read_bytes()
        if len(data) > max_bytes:
            return None
        return data.decode("utf-8", errors="ignore")
    except Exception:
        return None

def main():
    root = Path("Poison-Hunter")
    if not root.exists():
        raise SystemExit("Poison-Hunter folder not found. Make sure you cloned it into ai-risk/Poison-Hunter")

    addrs = []
    scanned = 0
    used = 0

    for fp in root.rglob("*"):
        if not fp.is_file():
            continue
        scanned += 1
        p = str(fp)
        # 只处理常见文本类（足够了；parquet/npy 我们先不碰）
        if not any(p.lower().endswith(ext) for ext in [".txt", ".csv", ".json", ".md"]):
            continue
        if not looks_relevant(p):
            continue

        txt = read_small_text(fp)
        if not txt:
            continue
        found = extract_from_text(txt)
        if found:
            addrs.extend(found)
            used += 1

    addrs = sorted(set(addrs))
    print("Scanned files:", scanned)
    print("Used files:", used)
    print("Unique ETH addresses extracted:", len(addrs))

    os.makedirs("data", exist_ok=True)
    out = Path("data/poison_hunter_eth_addrs_all.json")
    out.write_text(json.dumps({"seed": SEED, "addresses": addrs}, indent=2), encoding="utf-8")
    print("Wrote:", out)

if __name__ == "__main__":
    main()
