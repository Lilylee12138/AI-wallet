import os
import time
from typing import Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_bytes, to_canonical_address, is_address

from xgb_engine import predict_prob

app = FastAPI(title='AI Wallet Risk Engine (Step2-1: XGBoost scoring)', version='0.3.0')

app.add_middleware(
  CORSMiddleware,
  allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
  allow_credentials=False,
  allow_methods=['*'],
  allow_headers=['*']
)

class RiskRequest(BaseModel):
  diamond: str
  userOpHash: str
  to: str
  valueEth: float = Field(default=0.0, ge=0.0)

class Attestation(BaseModel):
  userOpHash: str
  riskScoreBps: int
  deadline: int

class RiskResponse(BaseModel):
  attestation: Attestation
  oracleSig: str
  reason: str
  riskProb: float

def _u256_32(x: int) -> bytes:
  return x.to_bytes(32, byteorder='big', signed=False)

def _u16_2(x: int) -> bytes:
  return x.to_bytes(2, byteorder='big', signed=False)

def _u48_6(x: int) -> bytes:
  return x.to_bytes(6, byteorder='big', signed=False)

def build_msg_hash(chain_id: int, diamond: str, user_op_hash: str, risk_score_bps: int, deadline: int) -> bytes:
  prefix = b'RISK_ATTEST_V1'
  chain_id_32 = _u256_32(chain_id)
  wallet_20 = to_canonical_address(diamond)
  op_hash_32 = to_bytes(hexstr=user_op_hash)
  score_2 = _u16_2(risk_score_bps)
  deadline_6 = _u48_6(deadline)
  packed = prefix + chain_id_32 + wallet_20 + op_hash_32 + score_2 + deadline_6
  return keccak(packed)

def blacklist_hit(to_addr: str) -> int:
  s = os.environ.get('HIGH_RISK_ADDRS', '')
  if not s:
    return 0
  bad = set(a.strip().lower() for a in s.split(',') if a.strip())
  return 1 if to_addr.lower() in bad else 0

def make_reason(prob: float, bl: int, value_eth: float) -> str:
  if bl == 1:
    return 'blacklist_hit=1'
  if prob >= 0.8:
    return 'xgboost: high risk probability'
  if prob >= 0.5:
    return 'xgboost: medium risk probability'
  if value_eth >= 1.0:
    return 'large value (model-based)'
  return 'xgboost: low risk probability'

@app.post('/risk', response_model=RiskResponse)
def risk(req: RiskRequest):
  oracle_pk = os.environ.get('ORACLE_PK')
  if not oracle_pk:
    raise HTTPException(status_code=500, detail='Missing ORACLE_PK')

  try:
    chain_id = int(os.environ.get('CHAIN_ID', '31337'))
  except Exception:
    chain_id = 31337

  if not is_address(req.diamond):
    raise HTTPException(status_code=400, detail='bad diamond')
  if not req.userOpHash.startswith('0x') or len(req.userOpHash) != 66:
    raise HTTPException(status_code=400, detail='bad userOpHash')
  if not is_address(req.to):
    raise HTTPException(status_code=400, detail='bad to address')

  bl = blacklist_hit(req.to)

  feats = {
    'value_eth': float(req.valueEth),
    'is_new_recipient': 1.0,
    'interaction_count': 0.0,
    'gas_gwei': 20.0,
    'blacklist_hit': float(bl),
    'repeat_tx': 0.0
  }

  prob = predict_prob(feats)
  score_bps = int(max(0.0, min(1.0, prob)) * 10000.0)
  reason = make_reason(prob, bl, float(req.valueEth))

  deadline = int(time.time()) + 600
  msg_hash = build_msg_hash(chain_id, req.diamond, req.userOpHash, score_bps, deadline)

  acct = Account.from_key(oracle_pk)
  sig = acct.sign_message(encode_defunct(msg_hash)).signature.hex()

  return {
    'attestation': {
      'userOpHash': req.userOpHash,
      'riskScoreBps': score_bps,
      'deadline': deadline
    },
    'oracleSig': '0x' + sig,
    'reason': reason,
    'riskProb': prob
  }
