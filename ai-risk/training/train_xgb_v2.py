import json
from pathlib import Path
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import xgboost as xgb

DATA_PATH = Path("data/transfer_v2.csv")
MODEL_OUT = Path("models/model_transfer_0002.json")
META_OUT = Path("models/model_transfer_0002.meta.json")

FEATURES = ["value_eth","is_new_recipient","interaction_count","gas_gwei","blacklist_hit","repeat_tx"]
LABEL = "label"

def main():
    df = pd.read_csv(DATA_PATH)

    X = df[FEATURES]
    y = df[LABEL]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # 处理类别不平衡：scale_pos_weight = neg/pos
    neg = (y_train == 0).sum()
    pos = (y_train == 1).sum()
    spw = float(neg) / float(pos) if pos > 0 else 1.0

    clf = xgb.XGBClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        objective="binary:logistic",
        eval_metric="auc",
        scale_pos_weight=spw,
        random_state=42,
        n_jobs=4,
    )

    clf.fit(X_train, y_train)

    prob = clf.predict_proba(X_test)[:,1]
    pred = (prob >= 0.5).astype(int)

    print("\n=== Classification Report (v2) ===")
    print(classification_report(y_test, pred, digits=4))
    auc = roc_auc_score(y_test, prob)
    print("AUC:", auc)

    clf.save_model(str(MODEL_OUT))

    meta = {
        "model": "xgboost",
        "version": "transfer_0002",
        "features": FEATURES,
        "label": LABEL,
        "threshold_default": 0.5,
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "scale_pos_weight": spw,
        "notes": "v2 = synthetic + mainnet_normal + malicious_aug (blacklist_hit forced 0 for hard negatives)"
    }
    META_OUT.write_text(json.dumps(meta, indent=2))
    print("Model saved to:", MODEL_OUT)
    print("Meta saved to:", META_OUT)

if __name__ == "__main__":
    main()
