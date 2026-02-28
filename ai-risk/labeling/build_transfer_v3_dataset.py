import pandas as pd
import numpy as np
from pathlib import Path

# 输入文件
REAL_NORMAL = Path("data/mainnet_normal_5000_clean.csv")
STAGE1 = Path("data/transfer_v2_stage1.csv")  # synthetic + real normal 合并后的 stage1

# 输出文件
OUT_MAL_HARD = Path("data/malicious_aug_v3_hard.csv")
OUT_NORM_BORDER = Path("data/normal_border_v3.csv")
OUT_V3 = Path("data/transfer_v3.csv")

# 训练特征列
COLS = ["value_eth","is_new_recipient","interaction_count","gas_gwei","blacklist_hit","repeat_tx","label"]

def sample_real(real_df: pd.DataFrame, n: int, seed: int = None) -> pd.DataFrame:
    return real_df.sample(n, replace=True, random_state=seed).reset_index(drop=True)

def build_v3(
    n_mal_hard: int = 6000,
    n_norm_border: int = 4000,
    random_seed: int = 42,
):
    if not REAL_NORMAL.exists():
        raise FileNotFoundError(f"Missing: {REAL_NORMAL}")
    if not STAGE1.exists():
        raise FileNotFoundError(f"Missing: {STAGE1}")

    real = pd.read_csv(REAL_NORMAL)
    stage1 = pd.read_csv(STAGE1)

    # 只保留统一列（确保后续能直接训练）
    real = real[COLS]
    stage1 = stage1[COLS]

    rng = np.random.default_rng(random_seed)

    # 1) Hard malicious: 恶意但更像正常（更难）
    base = sample_real(real, n_mal_hard)
    mal = pd.DataFrame({
        "value_eth": base["value_eth"].values,
        # 70% 新地址，30% 非新（模拟攻击者用“老地址/养号”伪装）
        "is_new_recipient": (rng.random(n_mal_hard) < 0.70).astype(int),
        # 更分散的交互次数（有些恶意会多次试探/重复）
        "interaction_count": rng.integers(0, 8, size=n_mal_hard),
        "gas_gwei": base["gas_gwei"].values,
        # 关键：强制为 0，防止模型偷学“黑名单命中=恶意”
        "blacklist_hit": np.zeros(n_mal_hard, dtype=int),
        # 20% repeat_tx=1（模拟“重复诱导/重复扣款”等行为）
        "repeat_tx": (rng.random(n_mal_hard) < 0.20).astype(int),
        "label": np.ones(n_mal_hard, dtype=int),
    })

    # 2) Borderline normal: 正常但看起来像恶意（减少误报）
    base2 = sample_real(real, n_norm_border)
    norm_border = pd.DataFrame({
        "value_eth": base2["value_eth"].values,
        # 很多正常用户第一次转账也会是新地址
        "is_new_recipient": (rng.random(n_norm_border) < 0.80).astype(int),
        # 低交互次数，靠近决策边界
        "interaction_count": rng.integers(0, 3, size=n_norm_border),
        "gas_gwei": base2["gas_gwei"].values,
        "blacklist_hit": np.zeros(n_norm_border, dtype=int),
        "repeat_tx": (rng.random(n_norm_border) < 0.05).astype(int),
        "label": np.zeros(n_norm_border, dtype=int),
    })

    # 保存两份增强数据
    mal.to_csv(OUT_MAL_HARD, index=False)
    norm_border.to_csv(OUT_NORM_BORDER, index=False)

    # 合并成 v3 总数据集
    v3 = pd.concat([stage1, mal, norm_border], ignore_index=True)
    v3 = v3.sample(frac=1, random_state=random_seed).reset_index(drop=True)
    v3.to_csv(OUT_V3, index=False)

    print("=== v3 dataset built ===")
    print("stage1 rows:", len(stage1))
    print("malicious_hard rows:", len(mal))
    print("normal_border rows:", len(norm_border))
    print("v3 total rows:", len(v3))
    print("label distribution:")
    print(v3["label"].value_counts())
    print("wrote:", OUT_MAL_HARD)
    print("wrote:", OUT_NORM_BORDER)
    print("wrote:", OUT_V3)

if __name__ == "__main__":
    build_v3()
