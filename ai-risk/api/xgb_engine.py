import os
from typing import Dict, List
import shap
import numpy as np
import xgboost as xgb

FEATURES: List[str] = [
  'value_eth',
  'is_new_recipient',
  'interaction_count',
  'gas_gwei',
  'blacklist_hit',
  'repeat_tx'
]

_engine = None

def get_engine():
  global _engine
  if _engine is None:
    model_path = os.environ.get('MODEL_PATH', 'ai-risk/models/model_transfer_0005.json')
    clf = xgb.XGBClassifier()
    print("[xgb] loading model from:", model_path)
    clf.load_model(model_path)
    _engine = clf
  return _engine

def predict_prob(feats: Dict[str, float]) -> float:
  clf = get_engine()
  x = np.array([[float(feats.get(k, 0.0)) for k in FEATURES]], dtype=np.float32)
  prob = clf.predict_proba(x)[0][1]
  return float(prob)


def predict_with_explain(feats: Dict[str, float]):
    clf = get_engine()
    x = np.array([[float(feats.get(k, 0.0)) for k in FEATURES]], dtype=np.float32)

    prob = float(clf.predict_proba(x)[0][1])

    explainer = shap.TreeExplainer(clf)
    shap_values = explainer.shap_values(x)

    # shap 对二分类模型有时返回 list，有时直接返回 ndarray
    if isinstance(shap_values, list):
        row_vals = shap_values[1][0]
    else:
        row_vals = shap_values[0]

    contrib = {name: float(val) for name, val in zip(FEATURES, row_vals)}

    return {
        "prob": prob,
        #"score_bps": int(prob * 10000),
        "score_bps": int(round(prob * 10000)),
        "features": {k: float(feats.get(k, 0.0)) for k in FEATURES},
        "contrib": contrib,
    }