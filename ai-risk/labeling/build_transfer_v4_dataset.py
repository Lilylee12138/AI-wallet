import pandas as pd
import numpy as np
from pathlib import Path

REAL_NORMAL_PATH = Path("data/mainnet_normal_5000_clean.csv")

OUT_SYN_NORMAL = Path("data/synthetic_normal_v4.csv")
OUT_MAL_V4 = Path("data/malicious_scenario_v4.csv")
OUT_V4 = Path("data/transfer_v4.csv")

COLS = [
    "value_eth",
    "is_new_recipient",
    "interaction_count",
    "gas_gwei",
    "blacklist_hit",
    "repeat_tx",
    "label",
]

rng = np.random.default_rng(42)


def sample_real(df: pd.DataFrame, n: int) -> pd.DataFrame:
    return df.sample(
        n=n,
        replace=True,
        random_state=int(rng.integers(0, 10**9))
    ).reset_index(drop=True)


def clip_series(x, low=None, high=None):
    s = pd.Series(x)
    if low is not None:
        s = s.clip(lower=low)
    if high is not None:
        s = s.clip(upper=high)
    return s


def build_synthetic_normal_v4(real: pd.DataFrame) -> pd.DataFrame:
    rows = []

    # A. 熟悉地址转账（低风险）
    n_a = 4000
    base = sample_real(real, n_a)
    a = pd.DataFrame({
        "value_eth": clip_series(base["value_eth"] * rng.uniform(0.8, 1.2, n_a), 0.001, 0.5),
        "is_new_recipient": np.zeros(n_a, dtype=int),
        "interaction_count": rng.integers(5, 21, n_a),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(0.9, 1.2, n_a), 15, 80),
        "blacklist_hit": np.zeros(n_a, dtype=int),
        "repeat_tx": np.zeros(n_a, dtype=int),
        "label": np.zeros(n_a, dtype=int),
    })
    rows.append(a)

    # B. 新地址小额测试（正常）
    n_b = 3000
    base = sample_real(real, n_b)
    b = pd.DataFrame({
        "value_eth": rng.uniform(0.0001, 0.01, n_b),
        "is_new_recipient": np.ones(n_b, dtype=int),
        "interaction_count": np.zeros(n_b, dtype=int),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(0.9, 1.1, n_b), 15, 60),
        "blacklist_hit": np.zeros(n_b, dtype=int),
        "repeat_tx": np.zeros(n_b, dtype=int),
        "label": np.zeros(n_b, dtype=int),
    })
    rows.append(b)

    # C. 高频熟悉对象转账（正常）
    # 注意：这里 repeat_tx 不再设为 1
    # 熟悉度由 interaction_count 表达，避免和“短时重复可疑尝试”冲突
    n_c = 3000
    base = sample_real(real, n_c)
    c = pd.DataFrame({
        "value_eth": clip_series(base["value_eth"] * rng.uniform(0.8, 1.1, n_c), 0.001, 0.2),
        "is_new_recipient": np.zeros(n_c, dtype=int),
        "interaction_count": rng.integers(10, 51, n_c),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(0.9, 1.15, n_c), 15, 70),
        "blacklist_hit": np.zeros(n_c, dtype=int),
        "repeat_tx": np.zeros(n_c, dtype=int),
        "label": np.zeros(n_c, dtype=int),
    })
    rows.append(c)

    # D. 新地址中额转账（边界正常）
    n_d = 2000
    base = sample_real(real, n_d)
    d = pd.DataFrame({
        "value_eth": rng.uniform(0.2, 1.0, n_d),
        "is_new_recipient": np.ones(n_d, dtype=int),
        "interaction_count": np.zeros(n_d, dtype=int),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(1.0, 1.3, n_d), 20, 100),
        "blacklist_hit": np.zeros(n_d, dtype=int),
        "repeat_tx": np.zeros(n_d, dtype=int),
        "label": np.zeros(n_d, dtype=int),
    })
    rows.append(d)

    # E. 高 gas 正常交易（边界正常）
    n_e = 2000
    e = pd.DataFrame({
        "value_eth": rng.uniform(0.05, 0.5, n_e),
        "is_new_recipient": rng.integers(0, 2, n_e),
        "interaction_count": rng.integers(3, 11, n_e),
        "gas_gwei": rng.uniform(80, 150, n_e),
        "blacklist_hit": np.zeros(n_e, dtype=int),
        "repeat_tx": np.zeros(n_e, dtype=int),
        "label": np.zeros(n_e, dtype=int),
    })
    rows.append(e)

    syn_normal = pd.concat(rows, ignore_index=True)
    return syn_normal[COLS]


def build_malicious_v4(real: pd.DataFrame) -> pd.DataFrame:
    rows = []

    # F. 黑名单攻击
    n_f = 1000
    base = sample_real(real, n_f)
    f = pd.DataFrame({
        "value_eth": clip_series(base["value_eth"] * rng.uniform(0.8, 1.5, n_f), 0.0005, 5.0),
        "is_new_recipient": np.ones(n_f, dtype=int),
        "interaction_count": rng.integers(0, 2, n_f),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(1.0, 1.5, n_f), 20, 200),
        "blacklist_hit": np.ones(n_f, dtype=int),
        "repeat_tx": np.zeros(n_f, dtype=int),
        "label": np.ones(n_f, dtype=int),
    })
    rows.append(f)

    # G. 新地址 + 高金额
    n_g = 3000
    base = sample_real(real, n_g)
    g = pd.DataFrame({
        "value_eth": rng.uniform(1.0, 5.0, n_g),
        "is_new_recipient": np.ones(n_g, dtype=int),
        "interaction_count": np.zeros(n_g, dtype=int),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(1.0, 1.8, n_g), 30, 150),
        "blacklist_hit": np.zeros(n_g, dtype=int),
        "repeat_tx": np.zeros(n_g, dtype=int),
        "label": np.ones(n_g, dtype=int),
    })
    rows.append(g)

    # H. 短时间重复攻击
    n_h = 3000
    base = sample_real(real, n_h)
    h = pd.DataFrame({
        "value_eth": rng.uniform(0.2, 2.0, n_h),
        "is_new_recipient": np.ones(n_h, dtype=int),
        "interaction_count": rng.integers(0, 3, n_h),
        "gas_gwei": clip_series(base["gas_gwei"] * rng.uniform(1.1, 1.8, n_h), 30, 150),
        "blacklist_hit": np.zeros(n_h, dtype=int),
        "repeat_tx": np.ones(n_h, dtype=int),
        "label": np.ones(n_h, dtype=int),
    })
    rows.append(h)

    # I. 高 gas 可疑行为
    n_i = 2000
    i = pd.DataFrame({
        "value_eth": rng.uniform(0.2, 2.0, n_i),
        "is_new_recipient": np.ones(n_i, dtype=int),
        "interaction_count": np.zeros(n_i, dtype=int),
        "gas_gwei": rng.uniform(150, 400, n_i),
        "blacklist_hit": np.zeros(n_i, dtype=int),
        "repeat_tx": np.zeros(n_i, dtype=int),
        "label": np.ones(n_i, dtype=int),
    })
    rows.append(i)

    mal = pd.concat(rows, ignore_index=True)
    return mal[COLS]


def main():
    if not REAL_NORMAL_PATH.exists():
        raise FileNotFoundError(f"Missing required file: {REAL_NORMAL_PATH}")

    real = pd.read_csv(REAL_NORMAL_PATH)[COLS]
    real["label"] = 0

    print("real normal:", len(real))

    syn_normal_v4 = build_synthetic_normal_v4(real)
    print("synthetic_normal_v4:", len(syn_normal_v4))

    mal_v4 = build_malicious_v4(real)
    print("malicious_scenario_v4:", len(mal_v4))

    syn_normal_v4.to_csv(OUT_SYN_NORMAL, index=False)
    mal_v4.to_csv(OUT_MAL_V4, index=False)

    v4 = pd.concat(
        [
            real,
            syn_normal_v4,
            mal_v4,
        ],
        ignore_index=True,
    )

    v4 = v4.sample(frac=1, random_state=42).reset_index(drop=True)
    v4 = v4[COLS]
    v4.to_csv(OUT_V4, index=False)

    print("\n=== pure transfer_v4 built ===")
    print("total rows:", len(v4))
    print("label distribution:")
    print(v4["label"].value_counts())
    print("\nwrote:", OUT_SYN_NORMAL)
    print("wrote:", OUT_MAL_V4)
    print("wrote:", OUT_V4)


if __name__ == "__main__":
    main()