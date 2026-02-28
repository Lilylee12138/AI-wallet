import os, time, json
import requests
import pandas as pd

RISKLIST_PATH = "data/Risklist.tagged.json"
OUT_CSV = "data/mainnet_normal_5000.csv"

API_KEY = os.getenv("ETHERSCAN_API_KEY")
if not API_KEY:
    raise SystemExit("Missing ETHERSCAN_API_KEY env var. Please: export ETHERSCAN_API_KEY='...'")

BASE = "https://api.etherscan.io/v2/api"

# 你现在的 whitelist 里这些就是“正常样本来源”（交易所/路由）
# 但我们抓“正常 transfer”优先从交易所地址抓，样本更像真实用户出入金。
SEED_ADDRESSES = [
    # Binance 9
    "0x001866ae5b3de6caa5a51543fd9fb64f524f5478",
    # Binance 14
    "0x28c6c06298d514db089934071355e5743bf21d60",
    # Coinbase 1
    "0xe85f78abb12594f3e73dc68bae19d216ba328697",
    # Coinbase 8 
    "0xe1a0ddeb9b5b55e489977b438764e60e314e917c",
]

def etherscan_txlist(address: str, page: int, offset: int = 200, sort: str = "desc"):
    params = {
        "chainid": 1,
        "module": "account",
        "action": "txlist",
        "address": address,
        "startblock": 0,
        "endblock": 99999999,
        "page": page,
        "offset": offset,
        "sort": sort,
        "apikey": API_KEY,
    }

    # 抗抖：最多重试 6 次，指数退避
    backoff = 1.0
    for attempt in range(6):
        try:
            r = requests.get(BASE, params=params, timeout=60)
            r.raise_for_status()
            j = r.json()

            # Etherscan V2 正常成功：status="1"
            if j.get("status") == "1":
                return j.get("result", [])

            # 常见失败：rate limit / busy / NOTOK
            msg = (j.get("message") or "").lower()
            res = (j.get("result") or "")
            # 没交易就直接返回空（正常）
            if "no transactions" in str(res).lower():
                return []

            # 其他 NOTOK：退避重试
            time.sleep(backoff)
            backoff = min(backoff * 1.8, 12.0)
            continue

        except (requests.exceptions.Timeout, requests.exceptions.ReadTimeout):
            time.sleep(backoff)
            backoff = min(backoff * 1.8, 12.0)
            continue
        except Exception:
            # 其他异常也退避重试一次
            time.sleep(backoff)
            backoff = min(backoff * 1.8, 12.0)
            continue

    # 多次失败后放弃该页
    return []

def load_blacklist_set():
    obj = json.load(open(RISKLIST_PATH, "r"))
    bl = obj.get("blacklist", {})
    # 你的 blacklist 是 dict: {address: {source, tag}}
    return set(a.lower() for a in bl.keys())

def to_float_eth(wei_str: str) -> float:
    try:
        return int(wei_str) / 10**18
    except:
        return 0.0

def to_float_gwei(wei_str: str) -> float:
    try:
        return int(wei_str) / 10**9
    except:
        return 0.0

def main(target_n=5000):
    blacklist = load_blacklist_set()

    seen_to = set()
    pair_count = {}  # (from,to) -> count
    seen_pair = set()

    rows = []
    seen_hash = set()

    # 为了“正常样本”，我们做这些过滤：
    # - 成功交易（isError == 0 且 txreceipt_status == 1）
    # - 有 to 地址（排除合约创建）
    # - value > 0 （纯 0 ETH 垃圾/探测交易过滤掉）
    # - to 不在 blacklist（保持 label=0 的高置信）
    # - 只保留 EOA -> EOA / EOA -> 合约 都行（我们先不区分）
    #   因为 transfer 风控主要看收款地址、金额、gas、交互频次等。
    for seed in SEED_ADDRESSES:
        page = 1
        while len(rows) < target_n and page <= 50:  # 最多翻 50 页，每页 1000 = 5w 理论上够
            txs = etherscan_txlist(seed, page=page, offset=200, sort="desc")
            if not txs:
                break

            for tx in txs:
                h = tx.get("hash", "").lower()
                if not h or h in seen_hash:
                    continue

                # 成功交易过滤
                if tx.get("isError") != "0":
                    continue
                if tx.get("txreceipt_status") not in (None, "", "1"):
                    continue

                to_addr = (tx.get("to") or "").lower()
                from_addr = (tx.get("from") or "").lower()
                if not to_addr or len(to_addr) != 42:
                    continue

                # 过滤 0 value
                value_eth = to_float_eth(tx.get("value", "0"))
                if value_eth <= 0:
                    continue

                # 高置信正常：排除命中黑名单的收款方
                if to_addr in blacklist:
                    continue

                gas_gwei = to_float_gwei(tx.get("gasPrice", "0"))

                # 构造与你现有 SyntheticRisk_transfer.csv 对齐的特征
                is_new_recipient = 1 if to_addr not in seen_to else 0
                seen_to.add(to_addr)

                pair = (from_addr, to_addr)
                interaction_count = pair_count.get(pair, 0)
                pair_count[pair] = interaction_count + 1

                repeat_tx = 1 if pair in seen_pair else 0
                seen_pair.add(pair)

                rows.append({
                    "value_eth": value_eth,
                    "is_new_recipient": is_new_recipient,
                    "interaction_count": interaction_count,
                    "gas_gwei": gas_gwei,
                    "blacklist_hit": 0,
                    "repeat_tx": repeat_tx,
                    "label": 0,

                    # 额外审计字段（不影响训练，你也可以之后删掉）
                    "txhash": h,
                    "blockNumber": int(tx.get("blockNumber", "0") or 0),
                    "from": from_addr,
                    "to": to_addr,
                })
                seen_hash.add(h)

                if len(rows) >= target_n:
                    break

            page += 1
            time.sleep(0.25)  # 温和一点，避免触发 rate limit

        if len(rows) >= target_n:
            break

    if len(rows) < target_n:
        print(f"[WARN] only collected {len(rows)} (< {target_n}). You can increase pages or add more seed addresses.")
    else:
        print(f"[OK] collected {len(rows)} rows")

    df = pd.DataFrame(rows)
    df.to_csv(OUT_CSV, index=False)
    print("Saved:", OUT_CSV)
    print(df.head(3).to_string(index=False))

if __name__ == "__main__":
    main(target_n=5000)
