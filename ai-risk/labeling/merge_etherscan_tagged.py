import json
from pathlib import Path

RISKLIST_PATH = Path("../data/Risklist.tagged.json")
WHITELIST_TXT = Path("../data/etherscan_whitelist_manual.txt")

def infer_tag(comment: str) -> str:
    c = (comment or "").lower()
    if any(k in c for k in ["binance", "coinbase", "kraken", "okx", "bybit", "exchange"]):
        return "exchange"
    if any(k in c for k in ["router", "uniswap", "1inch", "dex", "swap", "universal"]):
        return "defi_router"
    return "verified"

def load_addresses_with_comments(path: Path):
    """Return list of (address, comment). Comment is the last seen # line."""
    items = []
    last_comment = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            last_comment = line.lstrip("#").strip()
            continue

        # allow: "0xabc...  # something"
        addr = line.split()[0].strip().lower()
        if addr.startswith("0x") and len(addr) == 42:
            items.append((addr, last_comment))
    return items

def main():
    if not RISKLIST_PATH.exists():
        raise SystemExit(f"Risklist not found: {RISKLIST_PATH}")

    risk = json.loads(RISKLIST_PATH.read_text(encoding="utf-8"))

    # ensure dicts exist
    risk.setdefault("blacklist", {})
    risk.setdefault("whitelist", {})

    if not WHITELIST_TXT.exists():
        raise SystemExit(f"Whitelist txt not found: {WHITELIST_TXT}")

    items = load_addresses_with_comments(WHITELIST_TXT)
    if not items:
        raise SystemExit("No addresses parsed from etherscan_whitelist_manual.txt")

    added = 0
    updated = 0
    removed_from_blacklist = 0

    for addr, comment in items:
        meta = {
            "source": "etherscan-manual",
            "tag": infer_tag(comment),
        }

        if addr in risk["whitelist"]:
            # already exists: update tag/source to latest
            risk["whitelist"][addr] = meta
            updated += 1
        else:
            risk["whitelist"][addr] = meta
            added += 1

        # whitelist priority: remove from blacklist if present
        if addr in risk["blacklist"]:
            del risk["blacklist"][addr]
            removed_from_blacklist += 1

    RISKLIST_PATH.write_text(json.dumps(risk, indent=2), encoding="utf-8")

    print("=== Merge Complete (dict-based risklist) ===")
    print("Parsed from txt:", len(items))
    print("Added:", added)
    print("Updated:", updated)
    print("Removed from blacklist due to whitelist priority:", removed_from_blacklist)
    print("Total whitelist:", len(risk["whitelist"]))
    print("Total blacklist:", len(risk["blacklist"]))

if __name__ == "__main__":
    main()
