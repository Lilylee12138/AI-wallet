import random
import json
import os
import pandas as pd
import numpy as np

RISKLIST_PATH = "../data/Risklist.json"
OUTPUT_PATH = "../data/SyntheticRisk_transfer.csv"

N_SAMPLES = 20000

def load_risklist():
    with open(RISKLIST_PATH, "r") as f:
        return json.load(f)

def random_address():
    return "0x" + "".join(random.choices("0123456789abcdef", k=40))

def generate_sample(risklist):
    # 随机金额 (ETH)
    value = np.random.lognormal(mean=-5, sigma=1.5)

    # 随机是否新地址
    is_new_recipient = random.choice([0, 1])

    # 随机历史交互次数
    interaction_count = np.random.poisson(2)

    # gas 模拟
    gas_base = np.random.normal(30, 5)  # gwei
    gas_spike = random.random() < 0.05  # 5%概率异常
    if gas_spike:
        gas_base *= random.uniform(3, 6)

    # 黑名单概率
    blacklist_hit = random.random() < 0.02  # 2% 概率命中
    if blacklist_hit:
        recipient = random.choice(risklist["blacklist"])
    else:
        recipient = random_address()

    # 行为异常
    repeat_tx = random.random() < 0.05

    # ===== 规则打标签 =====
    risk = 0

    if blacklist_hit:
        risk += 3

    if is_new_recipient and value > 0.01:
        risk += 1

    if gas_spike:
        risk += 1

    if repeat_tx:
        risk += 1

    label = 1 if risk >= 2 else 0

    return {
        "value_eth": value,
        "is_new_recipient": is_new_recipient,
        "interaction_count": interaction_count,
        "gas_gwei": gas_base,
        "blacklist_hit": int(blacklist_hit),
        "repeat_tx": int(repeat_tx),
        "label": label
    }

def main():
    risklist = load_risklist()
    rows = [generate_sample(risklist) for _ in range(N_SAMPLES)]
    df = pd.DataFrame(rows)
    df.to_csv(OUTPUT_PATH, index=False)
    print("Generated:", OUTPUT_PATH)
    print("Total samples:", len(df))
    print("Positive samples:", df["label"].sum())

if __name__ == "__main__":
    main()