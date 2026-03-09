import json
import xgboost as xgb
import pandas as pd
from pathlib import Path

MODEL_PATH = Path("../models/model_transfer_0005.json")
META_PATH = Path("../models/model_transfer_0005.meta.json")

# 更符合 v4 语义的 baseline
BASE_FEATS = {
    "value_eth": 0.01,
    "is_new_recipient": 0.0,
    "interaction_count": 5.0,
    "gas_gwei": 30.0,
    "blacklist_hit": 0.0,
    "repeat_tx": 0.0,
}

TEST_GRID = {
    "value_eth": [0.0001, 0.001, 0.01, 0.1, 1.0, 5.0],
    "interaction_count": [0.0, 1.0, 3.0, 5.0, 10.0, 20.0],
    "gas_gwei": [10.0, 30.0, 50.0, 100.0, 200.0, 400.0],
    "is_new_recipient": [0.0, 1.0],
    "repeat_tx": [0.0, 1.0],
    "blacklist_hit": [0.0, 1.0],
}


def load_model_and_meta():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing model file: {MODEL_PATH}")
    if not META_PATH.exists():
        raise FileNotFoundError(f"Missing meta file: {META_PATH}")

    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_PATH))

    meta = json.loads(META_PATH.read_text())
    features = meta["features"]
    return model, meta, features


def predict_one(model, features, feats_dict):
    row = pd.DataFrame([[feats_dict[f] for f in features]], columns=features)
    prob = model.predict_proba(row)[0][1]
    score_bps = int(round(prob * 10000))
    return prob, score_bps


def run_one_factor_test():
    model, meta, features = load_model_and_meta()

    print("Loaded model:", MODEL_PATH)
    print("Loaded meta :", META_PATH)
    print("Features    :", features)
    print()

    for feat_name, test_values in TEST_GRID.items():
        print(f"=== One-factor test: {feat_name} ===")
        print("base_feats =", BASE_FEATS)
        print("-" * 80)

        for val in test_values:
            feats = dict(BASE_FEATS)
            feats[feat_name] = val
            prob, score_bps = predict_one(model, features, feats)
            print(
                f"{feat_name}={str(val):<10} -> "
                f"prob={prob:.6f}, score_bps={score_bps}, feats={feats}"
            )

        print()


if __name__ == "__main__":
    run_one_factor_test()
