import json
from pathlib import Path

import pandas as pd
import xgboost as xgb
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.model_selection import train_test_split

DATA_PATH = Path("data/transfer_v4.csv")
MODEL_OUT = Path("models/model_transfer_0004.json")
META_OUT = Path("models/model_transfer_0004.meta.json")

FEATURES = [
    "value_eth",
    "is_new_recipient",
    "interaction_count",
    "gas_gwei",
    "blacklist_hit",
    "repeat_tx",
]
LABEL = "label"


def main():
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Missing dataset: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)

    # 只保留必要列，防止脏列混进来
    needed_cols = FEATURES + [LABEL]
    missing = [c for c in needed_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required columns: {missing}")

    df = df[needed_cols].copy()

    # 基本信息
    print("=== Dataset Overview ===")
    print("rows:", len(df))
    print("label distribution:")
    print(df[LABEL].value_counts())
    print()

    X = df[FEATURES]
    y = df[LABEL]

    # 分层切分，保证正负样本比例一致
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y,
    )

    neg = int((y_train == 0).sum())
    pos = int((y_train == 1).sum())
    scale_pos_weight = float(neg) / float(pos) if pos > 0 else 1.0

    print("=== Train/Test Split ===")
    print("train rows:", len(X_train))
    print("test rows:", len(X_test))
    print("train neg:", neg)
    print("train pos:", pos)
    print("scale_pos_weight:", round(scale_pos_weight, 4))
    print()

    # v4 模型：先不用单调约束，先看语义是否改善
    clf = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        objective="binary:logistic",
        eval_metric="auc",
        scale_pos_weight=scale_pos_weight,
        random_state=42,
        n_jobs=4,
    )

    clf.fit(X_train, y_train)

    prob = clf.predict_proba(X_test)[:, 1]
    pred = (prob >= 0.5).astype(int)

    print("=== Classification Report (v4) ===")
    print(classification_report(y_test, pred, digits=4))

    auc = roc_auc_score(y_test, prob)
    print("AUC:", round(float(auc), 6))
    print()

    cm = confusion_matrix(y_test, pred)
    print("=== Confusion Matrix [[TN FP],[FN TP]] ===")
    print(cm)
    print()

    # 保存模型
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    clf.save_model(str(MODEL_OUT))

    # 保存 meta
    meta = {
        "model": "xgboost",
        "version": "transfer_0004",
        "dataset": str(DATA_PATH),
        "features": FEATURES,
        "label": LABEL,
        "threshold_default": 0.5,
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "train_neg": neg,
        "train_pos": pos,
        "scale_pos_weight": scale_pos_weight,
        "notes": (
            "v4 retrained on scenario-driven dataset. "
            "Dataset combines real normal transactions, synthetic normal scenarios, "
            "borderline normal cases, malicious scenarios, and selected hard malicious samples."
        ),
    }

    META_OUT.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print("Model saved to:", MODEL_OUT)
    print("Meta saved to:", META_OUT)


if __name__ == "__main__":
    main()
