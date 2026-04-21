import os
import time
import random
import json
from typing import Optional, Any, Dict, List

import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from openai import OpenAI
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi.packed import encode_packed
from eth_utils import keccak, to_hex, to_bytes

from xgb_engine import predict_prob, predict_with_explain

ENV_PATH = Path(__file__).resolve().with_name(".env")
load_dotenv(ENV_PATH, override=True)

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

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY in ai-risk/api/.env")

LLM_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
openai_client = OpenAI(api_key=OPENAI_API_KEY)

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


class ChatMessage(BaseModel):
    role: str
    content: str


class LlmChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    page: str = Field(..., min_length=1)
    context: Dict[str, Any] = Field(default_factory=dict)
    history: List[ChatMessage] = Field(default_factory=list)


class LlmChatResponse(BaseModel):
    reply: str
    model: str


class ZslRiskReviewRequest(BaseModel):
    page: str = Field(default="transfer")
    recipient: str = Field(..., min_length=1)
    amountEth: float = Field(default=0.0, ge=0.0)
    riskScoreBps: int = Field(default=0, ge=0, le=10000)
    riskReason: str = Field(default="")
    riskThresholdBps: int = Field(default=7000, ge=0, le=10000)

    gasGwei: Optional[float] = None
    maxFeeGwei: Optional[float] = None
    maxPriorityFeeGwei: Optional[float] = None

    candidateRisks: List[str] = Field(
        default_factory=lambda: [
            "normal transaction",
            "phishing or scam attempt",
            "suspicious behaviour",
            "high value anomaly",
            "urgent gas anomaly",
            "unknown but caution-worthy"
        ]
    )


class ZslRiskReviewResponse(BaseModel):
    riskCategory: str
    warnUser: bool
    confidence: str
    title: str
    explanation: str
    advice: str
    model: str


def build_attestation_hash(wallet: str, user_op_hash: str, risk_score_bps: int, deadline: int) -> bytes:
    user_op_hash_bytes = to_bytes(hexstr=user_op_hash)

    packed = encode_packed(
        ["string", "uint256", "address", "bytes32", "uint16", "uint48"],
        ["RISK_ATTEST_V1", CHAIN_ID, wallet, user_op_hash_bytes, risk_score_bps, deadline],
    )
    return keccak(packed)


def build_wallet_assistant_system_prompt(page: str, context: Dict[str, Any]) -> str:
    return f"""
You are an AI Smart Wallet Assistant.

You help users understand and interact with a modular smart contract wallet built on blockchain technology.

The wallet supports:
- ERC-4337 smart accounts
- ERC-2535 Diamond modular architecture
- token transfers
- token swaps
- AI-based risk analysis
- DAO governance voting

Your job is to help users understand what is happening in the wallet and guide them safely.

Communication style rules:

1. Always answer in clear and friendly English.
2. Assume the user is new to blockchain.
3. Use simple language and avoid technical jargon when possible.
4. If a technical term is used (gas, slippage, price impact), explain it very briefly.

IMPORTANT LENGTH RULES:

- Maximum **2 sentences**
- Maximum **40 words**
- Focus only on the **main reason and the key action**
- Avoid repetition and unnecessary background explanation
- Write like a **wallet UI tooltip**, not an article

Risk explanation rules:

- If a transaction has risk, explain the main reason briefly
- Suggest one simple action the user can take

Safety rules:

- Never invent blockchain state not provided in the context
- Only rely on the information below
- If information is missing, say the wallet does not currently provide that detail

Current page:
{page}

Wallet context:
{json.dumps(context, indent=2)}

Use simple language suitable for beginners.
""".strip()


def call_wallet_llm(message: str, page: str, context: Dict[str, Any], history: List[ChatMessage]) -> str:
    system_prompt = build_wallet_assistant_system_prompt(page, context)

    messages = [{"role": "system", "content": system_prompt}]

    for item in history[-8:]:
        if item.role in {"user", "assistant", "system"} and item.content.strip():
            messages.append({"role": item.role, "content": item.content})

    messages.append({"role": "user", "content": message})

    resp = openai_client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=0.3,
    )

    content = resp.choices[0].message.content

    if not content or not content.strip():
        return "Sorry, I couldn't generate a response for that request."

    return content.strip()


def extract_json_object(text: str) -> Dict[str, Any]:
    raw = (text or "").strip()

    if raw.startswith("```"):
        raw = raw.strip("`")
        lines = raw.splitlines()
        if lines and lines[0].lower().strip() == "json":
            lines = lines[1:]
        raw = "\n".join(lines).strip()

    start = raw.find("{")
    end = raw.rfind("}")

    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in model response")

    return json.loads(raw[start:end + 1])


def call_zsl_risk_review(req: ZslRiskReviewRequest) -> Dict[str, Any]:
    system_prompt = """
You are an AI security review module for a blockchain smart wallet.

This wallet uses:
- ERC-4337 account abstraction
- ERC-2535 Diamond modular smart contract architecture

Your task is to perform a zero-shot risk review for a transfer that was NOT hard-blocked by the XGBoost risk engine.

Important policy rules:
1. This review is advisory only.
2. Do NOT simulate chain state or invent facts.
3. Use only the structured signals provided.
4. If the transaction looks normal, return warnUser=false.
5. If the transaction is not hard-blocked but still looks suspicious, return warnUser=true.
6. Assume the user is a beginner.
7. Your output must be valid JSON only.

You must classify the transfer into one of the provided candidate risks and decide whether the user should receive a soft warning before continuing.
""".strip()

    payload = {
        "page": req.page,
        "recipient": req.recipient,
        "amountEth": req.amountEth,
        "riskScoreBps": req.riskScoreBps,
        "riskReason": req.riskReason,
        "riskThresholdBps": req.riskThresholdBps,
        "gasGwei": req.gasGwei,
        "maxFeeGwei": req.maxFeeGwei,
        "maxPriorityFeeGwei": req.maxPriorityFeeGwei,
        "candidateRisks": req.candidateRisks,
        "output_schema": {
            "riskCategory": "string",
            "warnUser": "boolean",
            "confidence": "low | medium | high",
            "title": "short string",
            "explanation": "short beginner-friendly explanation",
            "advice": "short actionable advice"
        }
    }

    user_prompt = f"""
Review the following transfer and return JSON only.

Transfer data:
{json.dumps(payload, indent=2)}

Decision guidance:
- If riskScoreBps >= riskThresholdBps, this would already be a hard-block case. In that situation, set warnUser=false because soft warning is not needed.
- If riskReason clearly suggests blacklist or hard-block logic, set warnUser=false.
- Otherwise, decide whether the transaction still deserves a user-facing soft warning.
- Prefer conservative but practical judgment.
- The explanation and advice must be short and friendly.

Return exactly one JSON object.
""".strip()

    resp = openai_client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
    )

    content = resp.choices[0].message.content or ""
    parsed = extract_json_object(content)

    risk_category = str(parsed.get("riskCategory", "normal transaction")).strip() or "normal transaction"
    warn_user = bool(parsed.get("warnUser", False))
    confidence = str(parsed.get("confidence", "low")).strip().lower() or "low"
    title = str(parsed.get("title", "Transaction review completed")).strip() or "Transaction review completed"
    explanation = str(parsed.get("explanation", "No additional AI warning was triggered.")).strip() or "No additional AI warning was triggered."
    advice = str(parsed.get("advice", "Please confirm the recipient and amount before sending.")).strip() or "Please confirm the recipient and amount before sending."

    if req.riskScoreBps >= req.riskThresholdBps or "rule:blacklist" in req.riskReason:
        warn_user = False
        if risk_category == "normal transaction":
            risk_category = "hard-block-already-handled"

    return {
        "riskCategory": risk_category,
        "warnUser": warn_user,
        "confidence": confidence,
        "title": title,
        "explanation": explanation,
        "advice": advice,
        "model": LLM_MODEL,
    }


@app.post("/risk", response_model=RiskResponse)
def risk(req: RiskRequest):
    wallet = req.diamond.lower()
    to = req.to.lower()

    if not wallet.startswith("0x") or len(wallet) != 42:
        raise HTTPException(status_code=400, detail=f"invalid diamond address: {req.diamond}")

    if not req.userOpHash.startswith("0x") or len(req.userOpHash) != 66:
        raise HTTPException(status_code=400, detail=f"invalid userOpHash: {req.userOpHash}")

    blacklist_hit = 1 if to in BLACKLIST_ADDRS else 0

    if blacklist_hit:
        meta = BLACKLIST_META.get(to, {})
        print("[risk] blacklist hit:", to, meta)

    seen = seen_recipients.setdefault(wallet, set())
    is_new_recipient = 0 if to in seen else 1
    seen.add(to)

    interaction_counter[wallet] = interaction_counter.get(wallet, 0) + 1
    interaction_count = interaction_counter[wallet]

    now = time.time()
    key = f"{wallet.lower()}->{req.to.lower()}"
    last_time = last_tx_cache.get(key)

    if last_time is not None and (now - last_time) < 30:
        repeat_tx = 1
    else:
        repeat_tx = 0

    last_tx_cache[key] = now

    raw_gas_gwei = float(req.gasGwei) if req.gasGwei is not None else 20.0

    gas_multiplier = random.uniform(0.8, 3.0)
    gas_gwei = raw_gas_gwei * gas_multiplier

    print("[risk] raw_gas_gwei =", raw_gas_gwei)
    print("[risk] gas_multiplier =", gas_multiplier)
    print("[risk] simulated_gas_gwei =", gas_gwei)

    feats = {
        "value_eth": float(req.valueEth),
        "is_new_recipient": float(is_new_recipient),
        "interaction_count": float(interaction_count),
        "gas_gwei": float(gas_gwei),
        "blacklist_hit": float(blacklist_hit),
        "repeat_tx": float(repeat_tx),
    }

    print("[risk] features =", feats)

    explain = predict_with_explain(feats)

    risk_prob = explain["prob"]
    risk_score = explain["score_bps"]

    print("[risk] prob =", risk_prob, "score_bps =", risk_score)

    print("\n[AI Risk Explanation]")
    for k, v in explain["features"].items():
        print(f"{k:20s} = {v}")

    print("\n[Feature Contributions]")
    for k, v in explain["contrib"].items():
        print(f"{k:20s} = {v:+.6f} (SHAP raw)")

    print(f"\nFinal risk_prob = {risk_prob:.6f}")
    print(f"Final risk_score_bps = {risk_score}")
    print("-" * 50)

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


@app.post("/llm/chat", response_model=LlmChatResponse)
def llm_chat(req: LlmChatRequest):
    try:
        reply = call_wallet_llm(
            message=req.message,
            page=req.page,
            context=req.context,
            history=req.history,
        )
        return LlmChatResponse(
            reply=reply,
            model=LLM_MODEL,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"llm chat failed: {e}")


@app.post("/llm/zsl-risk-review", response_model=ZslRiskReviewResponse)
def llm_zsl_risk_review(req: ZslRiskReviewRequest):
    try:
        result = call_zsl_risk_review(req)
        return ZslRiskReviewResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"zsl risk review failed: {e}")


@app.get("/risk/status")
def risk_status():
    return {
        "engine": "online",
        "model": "xgboost",
        "model_version": "transfer_v5",
        "oracle": "connected",
        "risk_level": "LOW"
    }