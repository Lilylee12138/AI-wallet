import os
import json
from typing import List, Optional

import xgboost as xgb
import pandas as pd
import matplotlib.pyplot as plt

DEFAULT_FEATURES = [
  'value_eth',
  'is_new_recipient',
  'interaction_count',
  'gas_gwei',
  'blacklist_hit',
  'repeat_tx',
]

def load_feature_names(meta_path: str) -> Optional[List[str]]:
  if not meta_path:
    return None
  if not os.path.exists(meta_path):
    return None
  try:
    with open(meta_path, 'r') as f:
      meta = json.load(f)
    # 兼容不同字段名
    for k in ['feature_names', 'features', 'columns']:
      v = meta.get(k)
      if isinstance(v, list) and len(v) > 0:
        return v
  except Exception:
    return None
  return None

def map_fid_to_name(fid: str, feature_names: List[str]) -> str:
  # fid 通常是 'f0','f1'...
  if fid.startswith('f'):
    try:
      idx = int(fid[1:])
      if 0 <= idx < len(feature_names):
        return feature_names[idx]
    except Exception:
      pass
  return fid

def importance_df(booster: xgb.Booster, feature_names: List[str], importance_type: str) -> pd.DataFrame:
  score = booster.get_score(importance_type=importance_type)
  rows = []
  for fid, val in score.items():
    rows.append({
      'feature': map_fid_to_name(fid, feature_names),
      importance_type: float(val),
    })
  if not rows:
    return pd.DataFrame(columns=['feature', importance_type])
  df = pd.DataFrame(rows).sort_values(importance_type, ascending=False).reset_index(drop=True)
  return df

def main():
  model_path = os.environ.get('MODEL_PATH', 'ai-risk/models/model_transfer_0004.json')
  meta_path = os.environ.get('MODEL_META_PATH', 'ai-risk/models/model_transfer_0004.meta.json')

  if not os.path.exists(model_path):
    raise SystemExit(f'[err] model not found: {model_path}')

  feature_names = load_feature_names(meta_path) or DEFAULT_FEATURES

  booster = xgb.Booster()
  booster.load_model(model_path)

  print('[info] MODEL_PATH =', model_path)
  print('[info] feature_names =', feature_names)

  # 三种重要性：weight(分裂次数), gain(平均增益), cover(覆盖样本量)
  df_gain = importance_df(booster, feature_names, 'gain')
  df_weight = importance_df(booster, feature_names, 'weight')
  df_cover = importance_df(booster, feature_names, 'cover')

  # 合并成一张表，缺失补 0
  df = pd.DataFrame({'feature': feature_names})
  df = df.merge(df_gain, on='feature', how='left')
  df = df.merge(df_weight, on='feature', how='left')
  df = df.merge(df_cover, on='feature', how='left')
  df = df.fillna(0.0)

  # 按 gain 排序（论文里通常用 gain）
  df = df.sort_values('gain', ascending=False).reset_index(drop=True)

  print('\n=== Feature importance (sorted by gain) ===')
  print(df.to_string(index=False))

  # 画图：按 gain
  out_png = os.environ.get('OUT_PNG', 'ai-risk/api/feature_importance_gain.png')
  plt.figure(figsize=(8, 4))
  plt.bar(df['feature'], df['gain'])
  plt.xticks(rotation=30, ha='right')
  plt.tight_layout()
  plt.savefig(out_png, dpi=200)
  print('\n[ok] saved plot to:', out_png)

if __name__ == '__main__':
  main()
