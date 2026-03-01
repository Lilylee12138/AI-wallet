import os
import time
from typing import Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_bytes, to_canonical_address, is_address

app = FastAPI(title='AI Wallet Risk Engine (Step1: server-side scoring)', version='0.2.0')

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

def score_rule_based(to_addr: str, value_eth: float) -> Tuple[int, str]:
  high_risk_addrs = set(
    a.strip().lower()
    for a in os.environ.get('HIGH_RISK_ADDRS', '').split(',')
    if a.strip()
  )

  to_l = to_addr.lower()

  if to_l in high_risk_addrs:
    return 9500, 'to address is in HIGH_RISK_ADDRS'

  if value_eth >= 1.0:
    return 7000, 'large value transfer (>= 1 ETH)'

  if value_eth >= 0.1:
    return 4000, 'medium value transfer (>= 0.1 ETH)'

  return 1200, 'default low risk (rule-based)'

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

  risk_score_bps, reason = score_rule_based(req.to, float(req.valueEth))

  deadline = int(time.time()) + 600
  msg_hash = build_msg_hash(chain_id, req.diamond, req.userOpHash, risk_score_bps, deadline)

  acct = Account.from_key(oracle_pk)
  sig = acct.sign_message(encode_defunct(msg_hash)).signature.hex()

  return {
    'attestation': {
      'userOpHash': req.userOpHash,
      'riskScoreBps': risk_score_bps,
      'deadline': deadline
    },
    'oracleSig': '0x' + sig,
    'reason': reason
  }
