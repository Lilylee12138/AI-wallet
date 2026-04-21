import os
import json
import warnings

import pandas as pd
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
)
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier

from xgboost import XGBClassifier
from catboost import CatBoostClassifier

warnings.filterwarnings("ignore")


# =========================
# 1. 配置区：按你的项目修改这里
# =========================

DATA_PATH = "data/transfer_v4.csv"   # 改成你的最终训练数据文件
OUTPUT_DIR = "benchmark_outputs"

FEATURES = [
    "value_eth",
    "is_new_recipient",
    "interaction_count",
    "gas_gwei",
    "blacklist_hit",
    "repeat_tx",
]

LABEL_COL = "label"   # 如果你的标签列不是 label，就改这里


# =========================
# 2. 工具函数
# =========================

def ensure_output_dir(path: str):
    os.makedirs(path, exist_ok=True)


def load_dataset(csv_path: str) -> pd.DataFrame:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"找不到数据文件: {csv_path}")

    df = pd.read_csv(csv_path)

    print("=== Dataset Preview ===")
    print(df.head())
    print("\n=== Columns ===")
    print(list(df.columns))
    print("\n=== Shape ===")
    print(df.shape)

    missing_features = [f for f in FEATURES if f not in df.columns]
    if missing_features:
        raise ValueError(f"数据里缺少这些特征列: {missing_features}")

    if LABEL_COL not in df.columns:
        raise ValueError(f"数据里找不到标签列: {LABEL_COL}")

    # 去掉空值
    df = df.dropna(subset=FEATURES + [LABEL_COL]).copy()

    return df


def build_models(scale_pos_weight: float):
    """
    返回要比较的模型字典
    """
    models = {
        "Logistic Regression": LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
            random_state=42
        ),
        "Random Forest": RandomForestClassifier(
            n_estimators=200,
            max_depth=8,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1
        ),
        "Neural Network": MLPClassifier(
            hidden_layer_sizes=(32, 16),
            activation="relu",
            solver="adam",
            max_iter=500,
            random_state=42
        ),
        "CatBoost": CatBoostClassifier(
            iterations=300,
            depth=4,
            learning_rate=0.05,
            loss_function="Logloss",
            verbose=False,
            random_state=42
        ),
        "XGBoost": XGBClassifier(
            n_estimators=500,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="binary:logistic",
            eval_metric="logloss",
            scale_pos_weight=scale_pos_weight,
            random_state=42
        ),
    }
    return models


def evaluate_model(model, X_train, X_test, y_train, y_test):
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    # 有些模型 predict_proba 可能返回二维
    if hasattr(model, "predict_proba"):
        y_prob = model.predict_proba(X_test)[:, 1]
    else:
        # 极少数情况备用
        y_prob = y_pred

    metrics = {
        "Accuracy": accuracy_score(y_test, y_pred),
        "Precision": precision_score(y_test, y_pred, zero_division=0),
        "Recall": recall_score(y_test, y_pred, zero_division=0),
        "F1": f1_score(y_test, y_pred, zero_division=0),
        "AUC": roc_auc_score(y_test, y_prob),
    }
    return metrics


def save_results_table(results_df: pd.DataFrame, output_dir: str):
    csv_path = os.path.join(output_dir, "benchmark_results.csv")
    results_df.to_csv(csv_path, index=False)
    print(f"\n[Saved] benchmark csv: {csv_path}")

    # 同时导出 latex 表格
    latex_path = os.path.join(output_dir, "benchmark_results.tex")
    with open(latex_path, "w", encoding="utf-8") as f:
        f.write(results_df.to_latex(index=False, float_format="%.4f"))
    print(f"[Saved] latex table: {latex_path}")


def plot_metric_bar(results_df: pd.DataFrame, metric: str, output_dir: str):
    plt.figure(figsize=(10, 5))
    plt.bar(results_df["Model"], results_df[metric])
    plt.xticks(rotation=20, ha="right")
    plt.ylabel(metric)
    plt.title(f"{metric} Comparison Across Models")
    plt.tight_layout()

    out_path = os.path.join(output_dir, f"{metric.lower()}_comparison.png")
    plt.savefig(out_path, dpi=200)
    plt.close()
    print(f"[Saved] plot: {out_path}")


# =========================
# 3. 主流程
# =========================

def main():
    ensure_output_dir(OUTPUT_DIR)

    df = load_dataset(DATA_PATH)

    X = df[FEATURES].copy()
    y = df[LABEL_COL].copy()

    print("\n=== Label Distribution ===")
    print(y.value_counts())

    # 80/20 stratified split，和论文保持一致
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        stratify=y,
        random_state=42
    )

    print("\n=== Train/Test Split ===")
    print(f"train rows: {len(X_train)}")
    print(f"test rows : {len(X_test)}")

    neg = (y_train == 0).sum()
    pos = (y_train == 1).sum()
    scale_pos_weight = neg / pos if pos > 0 else 1.0

    print(f"train neg: {neg}")
    print(f"train pos: {pos}")
    print(f"scale_pos_weight: {scale_pos_weight:.4f}")

    models = build_models(scale_pos_weight)

    all_results = []

    print("\n=== Benchmark Start ===")
    for model_name, model in models.items():
        print(f"\nRunning: {model_name}")
        metrics = evaluate_model(model, X_train, X_test, y_train, y_test)
        row = {"Model": model_name}
        row.update(metrics)
        all_results.append(row)
        print(metrics)

    results_df = pd.DataFrame(all_results)

    # 按 AUC 排序，方便展示
    results_df = results_df.sort_values(by="AUC", ascending=False).reset_index(drop=True)

    print("\n=== Final Benchmark Results ===")
    print(results_df)

    save_results_table(results_df, OUTPUT_DIR)

    # 画几个最常用的图
    for metric in ["Accuracy", "F1", "AUC"]:
        plot_metric_bar(results_df, metric, OUTPUT_DIR)


if __name__ == "__main__":
    main()