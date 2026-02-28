import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import json, os

DATA_PATH = "../data/SyntheticRisk_transfer.csv"
MODEL_PATH = "../models/model_transfer_0001.json"
META_PATH = "../models/model_transfer_0001.meta.json"

def main():
    df = pd.read_csv(DATA_PATH)
    X = df.drop(columns=["label"])
    y = df["label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = xgb.XGBClassifier(
        n_estimators=250,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=1.0,
        eval_metric="logloss"
    )

    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, y_prob)

    print("\\n=== Classification Report ===")
    print(classification_report(y_test, y_pred, digits=4))
    print("AUC:", auc)

    os.makedirs("../models", exist_ok=True)
    model.save_model(MODEL_PATH)

    meta = {
        "model_id": 1,
        "type": "transfer",
        "features": list(X.columns),
        "auc": float(auc),
        "data": os.path.basename(DATA_PATH)
    }
    with open(META_PATH, "w") as f:
        json.dump(meta, f, indent=2)

    print("\\nModel saved to:", MODEL_PATH)
    print("Meta saved to:", META_PATH)

if __name__ == "__main__":
    main()
