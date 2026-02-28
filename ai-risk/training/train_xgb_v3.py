import json
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
import xgboost as xgb

DATA_PATH = Path("data/transfer_v3.csv")
MODEL_OUT = Path("models/model_transfer_0003.json")
META_OUT = Path("models/model_transfer_0003.meta.json")

FEATURES = ["value_eth","is_new_recipient","interaction_count","gas_gwei","blacklist_hit","repeat_tx"]
LABEL = "label"

def main():
    df = pd.read_csv(DATA_PATH)

    X = df[FEATURES]
    y = df[LABEL]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    neg = int((y_train == 0).sum())
    pos = int((y_train == 1).sum())
    spw = float(neg) / float(pos) if pos > 0 else 1.0

    clf = xgb.XGBClassifier(
        n_estimators=600,
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

    prob = clf.predict_proba(X_test)[:, 1]
    pred = (prob >= 0.5).astype(int)

    print("\n=== Classification Report (v3) ===")
    print(classification_report(y_test, pred, digits=4))

    auc = roc_auc_score(y_test, prob)
    print("AUC:", auc)

    cm = confusion_matrix(y_test, pred)
    print("\nConfusion Matrix [[TN FP],[FN TP]]:")
    print(cm)

    clf.save_model(str(MODEL_OUT))

    meta = {
        "model": "xgboost",
        "version": "transfer_0003",
        "features": FEATURES,
        "label": LABEL,
        "threshold_default": 0.5,
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "scale_pos_weight": spw,
        "dataset": "transfer_v3.csv (stage1 + malicious_hard + normal_border)",
        "notes": "v3 introduces hard malicious + borderline normal to reduce shortcut learning and improve generalization"
    }
    META_OUT.write_text(json.dumps(meta, indent=2))
    print("\nModel saved to:", MODEL_OUT)
    print("Meta saved to:", META_OUT)

if __name__ == "__main__":
    main()
