import os
import time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_bytes, to_canonical_address

app = FastAPI(title='AI Wallet Risk Engine (MVP)', version='0.1.0')

# CORS: allow Vite dev server (and local testing)
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
  riskScoreBps: int = Field(default=1200, ge=0, le=10000)

class Attestation(BaseModel):
  userOpHash: str
  riskScoreBps: int
  deadline: int

class RiskResponse(BaseModel):
  attestation: Attestation
  oracleSig: str

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

@app.post('/risk', response_model=RiskResponse)
def risk(req: RiskRequest):
  oracle_pk = os.environ.get('ORACLE_PK')
  if not oracle_pk:
    raise HTTPException(status_code=500, detail='Missing ORACLE_PK')

  try:
    chain_id = int(os.environ.get('CHAIN_ID', '31337'))
  except Exception:
    chain_id = 31337

  if not req.diamond.startswith('0x') or len(req.diamond) != 42:
    raise HTTPException(status_code=400, detail='bad diamond')
  if not req.userOpHash.startswith('0x') or len(req.userOpHash) != 66:
    raise HTTPException(status_code=400, detail='bad userOpHash')

  deadline = int(time.time()) + 600

  msg_hash = build_msg_hash(chain_id, req.diamond, req.userOpHash, req.riskScoreBps, deadline)

  acct = Account.from_key(oracle_pk)
  sig = acct.sign_message(encode_defunct(msg_hash)).signature.hex()

  return {
    'attestation': {
      'userOpHash': req.userOpHash,
      'riskScoreBps': req.riskScoreBps,
      'deadline': deadline
    },
    'oracleSig': '0x' + sig
  }
