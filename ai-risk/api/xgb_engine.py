import os
from typing import Dict, List
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
    model_path = os.environ.get('MODEL_PATH', 'ai-risk/models/model_transfer_0003.json')
    clf = xgb.XGBClassifier()
    clf.load_model(model_path)
    _engine = clf
  return _engine

def predict_prob(feats: Dict[str, float]) -> float:
  clf = get_engine()
  x = np.array([[float(feats.get(k, 0.0)) for k in FEATURES]], dtype=np.float32)
  prob = clf.predict_proba(x)[0][1]
  return float(prob)
