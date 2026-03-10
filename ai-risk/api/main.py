import os
import time
import random
import json
from typing import Optional

import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi.packed import encode_packed
from eth_utils import keccak, to_hex, to_bytes

# from xgb_engine import predict_prob
from xgb_engine import predict_prob, predict_with_explain

load_dotenv("ai-risk/api/.env", override=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ORACLE_PRIVATE_KEY = os.getenv("ORACLE_PK") or os.getenv("ORACLE_PRIVATE_KEY")
if not ORACLE_PRIVATE_KEY:
    raise RuntimeError("Missing ORACLE_PK / ORACLE_PRIVATE_KEY in ai-risk/api/.env")

ORACLE = Account.from_key(ORACLE_PRIVATE_KEY)

CHAIN_ID = int(os.getenv("CHAIN_ID", "31337"))

#HIGH_RISK_ADDRS = set(
#    a.strip().lower()
#    for a in os.getenv("HIGH_RISK_ADDRS", "").split(",")
#    if a.strip()
#)

seen_recipients = {}
interaction_counter = {}

last_tx_cache = {}
# ===== Load external risk address dataset =====
RISKLIST_PATH = "ai-risk/data/Risklist.tagged.json"

with open(RISKLIST_PATH, "r") as f:
    risklist_data = json.load(f)

blacklist_obj = risklist_data.get("blacklist", {})

BLACKLIST_ADDRS = set()
BLACKLIST_META = {}

for addr, meta in blacklist_obj.items():
    addr_lc = addr.lower()
    BLACKLIST_ADDRS.add(addr_lc)
    BLACKLIST_META[addr_lc] = meta

print(f"[risk] loaded blacklist size = {len(BLACKLIST_ADDRS)}")

class RiskRequest(BaseModel):
    diamond: str
    userOpHash: str
    to: str
    valueEth: float = Field(default=0.0, ge=0.0)

    gasGwei: Optional[float] = None
    maxFeeGwei: Optional[float] = None
    maxPriorityFeeGwei: Optional[float] = None


class Attestation(BaseModel):
    userOpHash: str
    riskScoreBps: int
    deadline: int


class RiskResponse(BaseModel):
    riskScoreBps: int
    riskProb: float
    reason: str
    attestation: Attestation
    oracleSig: str

class SwapQuoteRequest(BaseModel):
    tokenIn: str
    tokenOut: str
    amountIn: float = Field(..., gt=0)


class SwapQuoteResponse(BaseModel):
    input: dict
    routes: list
    bestRoute: dict

def build_attestation_hash(wallet: str, user_op_hash: str, risk_score_bps: int, deadline: int) -> bytes:
    # Must match LibRiskOracle.attestationMessageHash exactly:
    # keccak256(abi.encodePacked(
    #   "RISK_ATTEST_V1",
    #   chainid,
    #   wallet,
    #   userOpHash,
    #   riskScoreBps,
    #   deadline
    # ))
    user_op_hash_bytes = to_bytes(hexstr=user_op_hash)

    packed = encode_packed(
        ["string", "uint256", "address", "bytes32", "uint16", "uint48"],
        ["RISK_ATTEST_V1", CHAIN_ID, wallet, user_op_hash_bytes, risk_score_bps, deadline],
    )
    return keccak(packed)


@app.post("/risk", response_model=RiskResponse)
def risk(req: RiskRequest):
    wallet = req.diamond.lower()
    to = req.to.lower()

    if not wallet.startswith("0x") or len(wallet) != 42:
        raise HTTPException(status_code=400, detail=f"invalid diamond address: {req.diamond}")

    if not req.userOpHash.startswith("0x") or len(req.userOpHash) != 66:
        raise HTTPException(status_code=400, detail=f"invalid userOpHash: {req.userOpHash}")

    # ===== Step 1: rule-based blacklist =====
    #blacklist_hit = 1 if to in HIGH_RISK_ADDRS else 0
    blacklist_hit = 1 if to in BLACKLIST_ADDRS else 0

    if blacklist_hit:
      meta = BLACKLIST_META.get(to, {})
      print("[risk] blacklist hit:", to, meta)

    # ===== Behavior state =====
    seen = seen_recipients.setdefault(wallet, set())
    is_new_recipient = 0 if to in seen else 1
    seen.add(to)

    interaction_counter[wallet] = interaction_counter.get(wallet, 0) + 1
    interaction_count = interaction_counter[wallet]
    #repeat_tx = 1 if interaction_count > 3 else 0
    now = time.time()

    key = f"{wallet.lower()}->{req.to.lower()}"
    last_time = last_tx_cache.get(key)

    if last_time is not None and (now - last_time) < 30:
        repeat_tx = 1
    else:
        repeat_tx = 0

    last_tx_cache[key] = now

    #gas_gwei = float(req.gasGwei) if req.gasGwei is not None else 20.0
    #print("[risk] gas_gwei=", gas_gwei)
    raw_gas_gwei = float(req.gasGwei) if req.gasGwei is not None else 20.0

    # simulate realistic gas fluctuation on top of Hardhat's stable gas
    gas_multiplier = random.uniform(0.8, 3.0)
    gas_gwei = raw_gas_gwei * gas_multiplier

    print("[risk] raw_gas_gwei =", raw_gas_gwei)
    print("[risk] gas_multiplier =", gas_multiplier)
    print("[risk] simulated_gas_gwei =", gas_gwei)

    # ===== Step 2: ML scoring =====
    feats = {
        "value_eth": float(req.valueEth),
        "is_new_recipient": float(is_new_recipient),
        "interaction_count": float(interaction_count),
        "gas_gwei": float(gas_gwei),
        "blacklist_hit": float(blacklist_hit),
        "repeat_tx": float(repeat_tx),
    }

    print("[risk] features =", feats)  

    #risk_prob = float(predict_prob(feats))
    #risk_score = int(risk_prob * 10000)

    #print("[risk] prob =", risk_prob, "score_bps =", risk_score)
    explain = predict_with_explain(feats)

    risk_prob = explain["prob"]
    risk_score = explain["score_bps"]

    print("[risk] prob =", risk_prob, "score_bps =", risk_score)

    print("\n[AI Risk Explanation]")
    for k, v in explain["features"].items():
        print(f"{k:20s} = {v}")

    print("\n[Feature Contributions]")
    for k, v in explain["contrib"].items():
        # print(f"{k:20s} = {v:+.6f}  (~{v*10000:+.1f} bps)")
        #SHAP 原始贡献值，不是 bps
        print(f"{k:20s} = {v:+.6f} (SHAP raw)")

    print(f"\nFinal risk_prob = {risk_prob:.6f}")
    print(f"Final risk_score_bps = {risk_score}")
    print("-" * 50)

    # ===== Paper-aligned reason =====
    if blacklist_hit:
        reason = "rule:blacklist"
    else:
        hints = []

        if req.valueEth > 1:
            hints.append("high_value")

        if is_new_recipient == 1:
            hints.append("new_recipient")

        if repeat_tx == 1:
            hints.append("repeat_tx")

        if gas_gwei > 100:
            hints.append("high_gas")

        if interaction_count <= 1:
            hints.append("low_history_interaction")

        reason = "model:xgboost" + ((" | hints:" + ",".join(hints)) if hints else "")

    deadline = int(time.time()) + 300

    # ===== MUST match LibRiskOracle.sol =====
    att_hash = build_attestation_hash(
        wallet=wallet,
        user_op_hash=req.userOpHash,
        risk_score_bps=risk_score,
        deadline=deadline,
    )

    print("[risk] wallet=", wallet)
    print("[risk] userOpHash=", req.userOpHash)
    print("[risk] riskScoreBps=", risk_score)
    print("[risk] deadline=", deadline)
    print("[risk] attHash=", to_hex(att_hash))
    print("[risk] oracle=", ORACLE.address)

    # EIP-191 personal_sign / eth_sign style
    msg = encode_defunct(hexstr=to_hex(att_hash))
    signed = Account.sign_message(msg, ORACLE_PRIVATE_KEY)
    oracle_sig = signed.signature.hex()
    if not str(oracle_sig).startswith('0x'):
        oracle_sig = '0x' + str(oracle_sig)

    return RiskResponse(
        riskScoreBps=risk_score,
        riskProb=risk_prob,
        reason=reason,
        attestation=Attestation(
            userOpHash=req.userOpHash,
            riskScoreBps=risk_score,
            deadline=deadline,
        ),
        oracleSig=oracle_sig,
    )

@app.post("/swap/quote", response_model=SwapQuoteResponse)
def swap_quote(req: SwapQuoteRequest):
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "quote_engine_api.ts"

    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"quote script not found: {script_path}")

    env = os.environ.copy()
    env["TOKEN_IN"] = req.tokenIn.upper()
    env["TOKEN_OUT"] = req.tokenOut.upper()
    env["AMOUNT_IN"] = str(req.amountIn)

    try:
        result = subprocess.run(
            [
                "npx",
                "hardhat",
                "run",
                str(script_path),
                "--network",
                "localhost",
            ],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="quote engine timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to run quote engine: {e}")

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "quote engine failed",
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
        )

    stdout = (result.stdout or "").strip()
    if not stdout:
        raise HTTPException(status_code=500, detail="quote engine returned empty stdout")

    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    json_line = lines[-1]

    try:
        data = json.loads(json_line)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "failed to parse quote engine json",
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
        )

    return SwapQuoteResponse(
        input=data["input"],
        routes=data["routes"],
        bestRoute=data["bestRoute"],
    )



