import os
import numpy as np
import xgboost as xgb

FEATURES = [
  'value_eth',
  'is_new_recipient',
  'interaction_count',
  'gas_gwei',
  'blacklist_hit',
  'repeat_tx'
]

def main():
  model_path = os.environ.get('MODEL_PATH', 'ai-risk/models/model_transfer_0004.json')
  print('[verify] MODEL_PATH =', model_path)

  clf = xgb.XGBClassifier()
  clf.load_model(model_path)
  print('[verify] model loaded')

  # dummy sample (you can tweak values)
  feats = {
    'value_eth': 0.001,
    'is_new_recipient': 1,
    'interaction_count': 0,
    'gas_gwei': 20.0,
    'blacklist_hit': 0,
    'repeat_tx': 0
  }

  x = np.array([[float(feats[k]) for k in FEATURES]], dtype=np.float32)
  prob = clf.predict_proba(x)[0][1]
  print('[verify] risk_prob =', float(prob))
  print('[verify] riskScoreBps =', int(float(prob) * 10000))

if __name__ == '__main__':
  main()
