import { useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'
import { appendHistory } from '../../lib/history'

import { getInjectedProvider, requestAccounts, getChainId } from '../../lib/eth'
import { loadDeployments } from '../../config/deployments'
import { buildUserOp, sendUserOp, signUserOpEOA_v2 } from '../../lib/aa'

const EXEC_ABI = ['function execute(address target,uint256 value,bytes data) returns (bytes)']

type ZslRiskReview = {
  riskCategory: string
  warnUser: boolean
  confidence: string
  title: string
  explanation: string
  advice: string
  model?: string
}

type PendingZslConfirm = {
  to: string
  amt: string
}

function hasWarningHint(reason: string) {
  return (
    reason.includes('new_recipient') ||
    reason.includes('repeat_tx') ||
    reason.includes('high_gas') ||
    reason.includes('low_history_interaction') ||
    reason.includes('high_value')
  )
}

function isRiskRejected(msg: string) {
  return msg.includes('AA24') || msg.includes('RiskOracle')
}

function isDepositIssue(msg: string) {
  const s = msg.toLowerCase()
  return (
    s.includes('deposit') ||
    s.includes('entrypoint') ||
    s.includes("aa21 didn't pay prefund") ||
    s.includes('prefund')
  )
}

function mapFriendlyTransferError(raw: string) {
  const msg = String(raw || '')

  if (msg.includes("AA21 didn't pay prefund")) {
    return {
      title: 'Not enough gas prefund',
      message:
        'This transfer could not be submitted because the smart wallet does not have enough prefund for the ERC-4337 operation. Please add more ETH to the wallet or deposit more ETH into the EntryPoint gas tank, then try again.'
    }
  }

  if (msg.includes('AA24') || msg.includes('RiskOracle')) {
    return {
      title: 'Transfer rejected by risk protection',
      message:
        'This transfer was blocked by the wallet risk protection logic. The oracle, attestation, or user signature verification did not pass.'
    }
  }

  if (msg.includes('Recipient is required')) {
    return {
      title: 'Recipient required',
      message:
        'Please enter a valid recipient address before sending the transfer.'
    }
  }

  if (msg.includes('Amount must be > 0')) {
    return {
      title: 'Invalid amount',
      message:
        'The transfer amount must be greater than zero.'
    }
  }

  if (msg.includes('MetaMask not connected')) {
    return {
      title: 'Wallet not connected',
      message:
        'Your wallet is not connected. Please connect MetaMask first, then try again.'
    }
  }

  if (msg.includes('user rejected') || msg.includes('User denied')) {
    return {
      title: 'Transaction cancelled',
      message:
        'The transaction was cancelled in the wallet before it was submitted.'
    }
  }

  return {
    title: 'Transfer failed',
    message:
      'The transfer could not be completed. Please check the recipient address, wallet balance, EntryPoint gas tank balance, and risk warning details, then try again.'
  }
}

function shortenError(raw: string) {
  const text = String(raw || '')
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

function shortHash(v: string, left = 8, right = 6) {
  if (!v) return ''
  if (v.length <= left + right + 3) return v
  return `${v.slice(0, left)}...${v.slice(-right)}`
}

async function copyText(text: string) {
  if (!text) return

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {}

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

export default function ActionTransfer() {
  const nav = useNavigate()

  const [dep, setDep] = useState<any>(null)
  const [to, setTo] = useState('')
  const [amt, setAmt] = useState('0.001')

  const [riskScore, setRiskScore] = useState<number | null>(null)
  const [riskReason, setRiskReason] = useState<string>('')

  const [sending, setSending] = useState(false)
  const [txMsg, setTxMsg] = useState('')
  const [txHash, setTxHash] = useState('')
  const [copiedTx, setCopiedTx] = useState(false)
  const [txErr, setTxErr] = useState('')

  const [friendlyErrorTitle, setFriendlyErrorTitle] = useState('')
  const [friendlyErrorMessage, setFriendlyErrorMessage] = useState('')
  const [errorModalOpen, setErrorModalOpen] = useState(false)

  const [aiExplaining, setAiExplaining] = useState(false)
  const [aiReply, setAiReply] = useState('')
  const [aiErr, setAiErr] = useState('')
  const [lastRiskAmount, setLastRiskAmount] = useState<string>('')

  const [manualExplainOpen, setManualExplainOpen] = useState(false)
  const [autoExplained, setAutoExplained] = useState(false)

  const [zslReview, setZslReview] = useState<ZslRiskReview | null>(null)
  const [zslModalOpen, setZslModalOpen] = useState(false)
  const [zslReviewing, setZslReviewing] = useState(false)
  const pendingZslConfirmRef = useRef<PendingZslConfirm | null>(null)

  const riskThresholdBps = Number(import.meta.env.VITE_RISK_THRESHOLD_BPS || 7000)

  async function loadDep() {
    const p = getInjectedProvider()
    await requestAccounts(p)
    const chainId = await getChainId(p)
    const d = await loadDeployments(chainId)
    setDep(d)
    return { p, d }
  }

  function showFriendlyError(raw: string) {
    const mapped = mapFriendlyTransferError(raw)
    setTxErr(raw)
    setFriendlyErrorTitle(mapped.title)
    setFriendlyErrorMessage(mapped.message)
    setErrorModalOpen(true)
  }

  useEffect(() => {
    ;(async () => {
      try {
        await loadDep()
      } catch (e: any) {
        const raw = e?.message || String(e)
        showFriendlyError(raw)
      }
    })()
  }, [])

  async function fetchRisk(params: {
    diamond: string
    userOpHash: string
    to: string
    valueEth: number
    gasGwei?: number
    maxFeeGwei?: number
    maxPriorityFeeGwei?: number
  }) {
    const r = await fetch('http://localhost:8787/risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j?.detail || j?.error || 'risk engine error')
    return j as {
      attestation: { userOpHash: string; riskScoreBps: number; deadline: number }
      oracleSig: string
      reason: string
    }
  }

  async function fetchZslRiskReview(params: {
    recipient: string
    amountEth: number
    riskScoreBps: number
    riskReason: string
    riskThresholdBps: number
    gasGwei?: number
    maxFeeGwei?: number
    maxPriorityFeeGwei?: number
  }) {
    const r = await fetch('http://127.0.0.1:8787/llm/zsl-risk-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: 'transfer',
        ...params
      })
    })

    const j = await r.json()
    if (!r.ok) throw new Error(j?.detail || j?.error || 'zsl risk review error')

    return j as ZslRiskReview
  }

  async function explainTransferWithAI(mode: 'auto' | 'manual' = 'manual') {
    if (riskScore === null && !txErr && !zslReview) return

    setAiErr('')
    setAiExplaining(true)

    try {
      const context = {
        page: 'transfer',
        recipient: to.trim(),
        amountEth: Number(lastRiskAmount || amt || '0'),
        riskScoreBps: riskScore ?? 0,
        riskReason,
        txStatus: txErr ? 'failed' : txMsg ? 'success' : 'pending',
        txError: txErr || '',
        entryPointDepositIssue: isDepositIssue(txErr),
        rejectedByRiskOracle: isRiskRejected(txErr),
        riskThresholdBps,
        lastErrorFriendlyTitle: friendlyErrorTitle || '',
        lastErrorFriendlyMessage: friendlyErrorMessage || '',
        zslWarnUser: zslReview?.warnUser ?? false,
        zslRiskCategory: zslReview?.riskCategory || '',
        zslTitle: zslReview?.title || '',
        zslExplanation: zslReview?.explanation || '',
        zslAdvice: zslReview?.advice || ''
      }

      let message =
        'Please explain this transfer result in a gentle, beginner-friendly way. Keep it concise and practical.'

      if (isDepositIssue(txErr)) {
        message =
          'Please explain in a gentle, beginner-friendly way that this transfer could not proceed because the EntryPoint deposit or prefund is insufficient. Explain what EntryPoint deposit means in an ERC-4337 wallet and what the user should do next.'
      } else if ((riskScore ?? 0) >= riskThresholdBps || riskReason.includes('rule:blacklist') || isRiskRejected(txErr)) {
        message =
          'Please explain this high-risk or rejected transfer in a gentle, beginner-friendly way. Explain what the risk score means, why this transfer was blocked or considered dangerous, and what the user should do next.'
      } else if (zslReview?.warnUser) {
        message =
          'Please explain this AI soft warning in a gentle, beginner-friendly way. Explain that the hard risk model did not block the transaction, but the zero-shot AI review still noticed a suspicious pattern. Make clear that the user may continue after checking the recipient and amount carefully.'
      } else if (txErr) {
        message =
          'Please explain this failed transfer in a gentle, beginner-friendly way. Explain what likely went wrong and what the user should check next.'
      } else {
        message =
          'Please explain this transfer warning in a gentle, beginner-friendly way. Explain what the score and reason mean, why there is a reminder, and what the user should check before continuing in the future.'
      }

      const r = await fetch('http://127.0.0.1:8787/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          page: 'transfer',
          context,
          history: []
        })
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail || j?.error || 'llm chat error')

      setAiReply(j?.reply || '')
      if (mode === 'manual') setManualExplainOpen(true)
    } catch (e: any) {
      setAiErr(e?.message || String(e))
      if (mode === 'manual') setManualExplainOpen(true)
    } finally {
      setAiExplaining(false)
    }
  }

  const autoExplain = useMemo(() => {
    return (
      (riskScore ?? 0) >= riskThresholdBps ||
      riskReason.includes('rule:blacklist') ||
      isRiskRejected(txErr) ||
      isDepositIssue(txErr)
    )
  }, [riskScore, riskReason, txErr, riskThresholdBps])

  const showExplainButton = useMemo(() => {
    if (autoExplain) return false

    return (
      hasWarningHint(riskReason) ||
      !!zslReview?.warnUser ||
      ((riskScore ?? 0) > 0 && !txMsg) ||
      !!txErr
    )
  }, [autoExplain, riskReason, riskScore, txErr, txMsg, zslReview])

  const showExplainSection = autoExplain || manualExplainOpen

  useEffect(() => {
    if (!autoExplain) return
    if (autoExplained) return
    if (aiExplaining) return
    if (aiReply) return

    setAutoExplained(true)
    explainTransferWithAI('auto').catch((e) => {
      console.error(e)
    })
  }, [autoExplain, autoExplained, aiExplaining, aiReply])

  useEffect(() => {
    try {
      const contextPayload = {
        page: 'transfer',
        title: 'Send',
        path: window.location.pathname,
        context: {
          recipient: to.trim(),
          amountEth: Number(lastRiskAmount || amt || '0'),
          riskScoreBps: riskScore,
          riskReason,
          txStatus: txErr ? 'failed' : txMsg ? 'success' : sending ? 'pending' : 'idle',
          txError: txErr || '',
          entryPointDepositIssue: isDepositIssue(txErr),
          rejectedByRiskOracle: isRiskRejected(txErr),
          riskThresholdBps,
          lastErrorFriendlyTitle: friendlyErrorTitle || '',
          lastErrorFriendlyMessage: friendlyErrorMessage || '',
          zslWarnUser: zslReview?.warnUser ?? false,
          zslRiskCategory: zslReview?.riskCategory || '',
          zslTitle: zslReview?.title || '',
          zslExplanation: zslReview?.explanation || '',
          zslAdvice: zslReview?.advice || ''
        }
      }

      sessionStorage.setItem('wallet_ai_context', JSON.stringify(contextPayload))
    } catch (e) {
      console.error(e)
    }
  }, [
    to,
    amt,
    lastRiskAmount,
    riskScore,
    riskReason,
    txMsg,
    txErr,
    sending,
    riskThresholdBps,
    friendlyErrorTitle,
    friendlyErrorMessage,
    zslReview
  ])

  async function executeTransfer(opts?: {
    overrideTo?: string
    overrideAmt?: string
    skipZsl?: boolean
  }) {
    const recipientInput = (opts?.overrideTo ?? to).trim()
    const amountInput = (opts?.overrideAmt ?? amt).trim()
    const skipZsl = !!opts?.skipZsl

    const { p, d } = await loadDep()

    if (!recipientInput) throw new Error('Recipient is required')
    const recipient = ethers.utils.getAddress(recipientInput)

    const value = ethers.utils.parseEther((amountInput || '0').trim())
    if (value.lte(0)) throw new Error('Amount must be > 0')

    const accounts = await p.listAccounts()
    if (!accounts.length) throw new Error('MetaMask not connected')
    const beneficiary = accounts[0]

    const execIface = new ethers.utils.Interface(EXEC_ABI)
    const callData = execIface.encodeFunctionData('execute', [recipient, value, '0x'])

    const { userOp, userOpHash } = await buildUserOp({
      provider: p,
      entryPoint: d.entryPoint,
      diamond: d.diamondAccount,
      callData
    })

    const fee = await p.getFeeData()
    const maxFee = fee.maxFeePerGas ?? fee.gasPrice
    const maxPrio = fee.maxPriorityFeePerGas ?? null

    const maxFeeGwei = maxFee ? Number(ethers.utils.formatUnits(maxFee, 'gwei')) : undefined
    const maxPriorityFeeGwei = maxPrio ? Number(ethers.utils.formatUnits(maxPrio, 'gwei')) : undefined
    const gasGwei = maxFeeGwei

    const risk = await fetchRisk({
      diamond: d.diamondAccount,
      userOpHash,
      to: recipient,
      valueEth: Number(amountInput || '0'),
      gasGwei,
      maxFeeGwei,
      maxPriorityFeeGwei
    })

    setRiskScore(risk.attestation.riskScoreBps)
    setRiskReason(risk.reason || '')
    setLastRiskAmount(amountInput || '0')

    const hardRisk =
      risk.attestation.riskScoreBps >= riskThresholdBps ||
      (risk.reason || '').includes('rule:blacklist')

    if (!hardRisk && !skipZsl) {
      setZslReviewing(true)

      try {
        const zsl = await fetchZslRiskReview({
          recipient,
          amountEth: Number(amountInput || '0'),
          riskScoreBps: risk.attestation.riskScoreBps,
          riskReason: risk.reason || '',
          riskThresholdBps,
          gasGwei,
          maxFeeGwei,
          maxPriorityFeeGwei
        })

        setZslReview(zsl)

        if (zsl.warnUser) {
          pendingZslConfirmRef.current = {
            to: recipientInput,
            amt: amountInput
          }
          setZslModalOpen(true)
          return
        }
      } finally {
        setZslReviewing(false)
      }
    }

    const signedUserOp = {
      ...userOp,
      signature: await signUserOpEOA_v2({
        provider: p,
        userOpHash,
        attestation: risk.attestation,
        oracleSig: risk.oracleSig
      })
    }

    const result = await sendUserOp({
      provider: p,
      entryPoint: d.entryPoint,
      beneficiary,
      userOp: signedUserOp
    })

    const receipt = (result as any)?.receipt || result
    const txHashValue = (receipt as any)?.transactionHash || ''

    const chainId = await getChainId(p)

    appendHistory(
      chainId,
      d.diamondAccount,
      {
        id: Date.now().toString(),
        type: 'transfer',
        time: Date.now(),
        tokenIn: 'ETH',
        amountIn: amountInput,
        to: recipient,
        txHash: txHashValue
      }
    )

    setTxMsg('Sent successfully')
    setTxHash(txHashValue)
  }

  async function continueAfterZslWarning() {
    const pending = pendingZslConfirmRef.current
    if (!pending) return

    setZslModalOpen(false)
    setSending(true)

    try {
      await executeTransfer({
        overrideTo: pending.to,
        overrideAmt: pending.amt,
        skipZsl: true
      })
      pendingZslConfirmRef.current = null
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e)

      if (String(msg).includes('AA24')) {
        showFriendlyError('Rejected by RiskOracle: attestation or signature verification failed (AA24)')
      } else {
        showFriendlyError(msg)
      }
    } finally {
      setSending(false)
      setZslReviewing(false)
    }
  }

  async function send() {
    setTxMsg('')
    setTxHash('')
    setCopiedTx(false)
    setTxErr('')
    setRiskScore(null)
    setRiskReason('')
    setFriendlyErrorTitle('')
    setFriendlyErrorMessage('')
    setErrorModalOpen(false)
    setAiReply('')
    setAiErr('')
    setLastRiskAmount('')
    setManualExplainOpen(false)
    setAutoExplained(false)
    setZslReview(null)
    setZslModalOpen(false)
    pendingZslConfirmRef.current = null
    setSending(true)

    try {
      await executeTransfer()
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e)

      if (String(msg).includes('AA24')) {
        showFriendlyError('Rejected by RiskOracle: attestation or signature verification failed (AA24)')
      } else {
        showFriendlyError(msg)
      }
    } finally {
      setSending(false)
      setZslReviewing(false)
    }
  }

  return (
    <Layout title='Send'>
      {errorModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div
            className='card'
            style={{
              width: 'min(520px, 100%)',
              padding: 18,
              borderColor: 'rgba(255,77,90,.25)',
              boxShadow: '0 24px 80px rgba(0,0,0,.35)'
            }}
          >
            <div
              className='row'
              style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <div className='h2' style={{ color: 'rgba(255,220,220,.96)' }}>
                {friendlyErrorTitle || 'Transfer failed'}
              </div>

              <button
                className='btn btnGhost'
                onClick={() => setErrorModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div
              className='small'
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                opacity: 0.92
              }}
            >
              {friendlyErrorMessage}
            </div>

            {txErr && (
              <div
                className='small'
                style={{
                  marginTop: 14,
                  opacity: 0.68,
                  whiteSpace: 'pre-wrap'
                }}
              >
                Raw error: {shortenError(txErr)}
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button
                className='btn btnGhost'
                style={{ flex: 1 }}
                onClick={async () => {
                  setErrorModalOpen(false)
                  setManualExplainOpen(true)
                  await explainTransferWithAI('manual')
                }}
              >
                Explain this error with AI
              </button>

              <button
                className='btn btnPrimary'
                style={{ flex: 1 }}
                onClick={() => setErrorModalOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {zslModalOpen && zslReview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            zIndex: 85,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div
            className='card'
            style={{
              width: 'min(560px, 100%)',
              padding: 18,
              borderColor: 'rgba(255,190,90,.25)',
              boxShadow: '0 24px 80px rgba(0,0,0,.35)'
            }}
          >
            <div
              className='row'
              style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <div className='h2' style={{ color: 'rgba(255,235,210,.96)' }}>
                {zslReview.title || 'Potential risk detected'}
              </div>

              <button
                className='btn btnGhost'
                onClick={() => {
                  setZslModalOpen(false)
                  pendingZslConfirmRef.current = null
                }}
              >
                Close
              </button>
            </div>

            <div
              className='small'
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                opacity: 0.92
              }}
            >
              {zslReview.explanation}
            </div>

            <div
              className='small'
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                opacity: 0.82
              }}
            >
              Risk category: {zslReview.riskCategory}
              <br />
              Confidence: {zslReview.confidence}
              <br />
              Advice: {zslReview.advice}
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button
                className='btn btnGhost'
                style={{ flex: 1 }}
                onClick={() => {
                  setZslModalOpen(false)
                  pendingZslConfirmRef.current = null
                }}
              >
                Cancel
              </button>

              <button
                className='btn btnPrimary'
                style={{ flex: 1 }}
                onClick={continueAfterZslWarning}
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Transfer (AA)</div>
        <div className='small' style={{ marginTop: 8 }}>
          Transfer executed via an ERC-4337 UserOp through the smart account (DiamondAccount → ExecutionFacet.execute).
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <input
            className='input'
            placeholder='Recipient address (0x...)'
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <input
            className='input'
            placeholder='Amount (ETH)'
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />

          <button className='btn btnPrimary' disabled={sending || zslReviewing || !dep} onClick={send}>
            {sending ? 'Sending…' : zslReviewing ? 'Reviewing…' : 'Send (AA UserOp)'}
          </button>

          {riskScore !== null && (
            <div className='small' style={{ marginTop: 10, opacity: 0.9 }}>
              Risk score (bps): {riskScore}
            </div>
          )}

          {riskReason && (
            <div className='small' style={{ marginTop: 6, opacity: 0.75 }}>
              Reason: {riskReason}
            </div>
          )}

          {showExplainButton && (
            <div style={{ marginTop: 12 }}>
              <button
                className='btn btnGhost'
                onClick={() => explainTransferWithAI('manual')}
                disabled={aiExplaining}
              >
                {aiExplaining ? 'Explaining…' : 'Explain this risk with AI'}
              </button>
            </div>
          )}

          {showExplainSection && aiReply && (
            <div
              className='small'
              style={{
                marginTop: 12,
                opacity: 0.92,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap'
              }}
            >
              <div style={{ marginBottom: 6, fontWeight: 700 }}>AI Explanation</div>
              <div>{aiReply}</div>
            </div>
          )}

          {aiErr && (
            <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>
              AI explain error: {aiErr}
            </div>
          )}

          {txMsg && (
            <div
              className='cardSoft'
              style={{
                marginTop: 10,
                padding: 12,
                border: '1px solid rgba(90,255,210,.18)',
                background: 'rgba(90,255,210,.06)',
              }}
            >
              <div style={{ color: 'var(--green)', fontWeight: 800 }}>
                {txMsg}
              </div>

              {txHash && (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div
                    className='small'
                    style={{
                      color: 'rgba(255,255,255,.82)',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      flex: 1,
                    }}
                  >
                    Tx: {shortHash(txHash)}
                  </div>

                  <button
                    type='button'
                    className='btn btnGhost'
                    style={{ minWidth: 0, padding: '6px 10px' }}
                    onClick={async () => {
                      await copyText(txHash)
                      setCopiedTx(true)
                      window.setTimeout(() => setCopiedTx(false), 1200)
                    }}
                  >
                    {copiedTx ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {txErr && <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>{txErr}</div>}

          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>

        <div className='small' style={{ marginTop: 12, opacity: 0.75 }}>
          Note: The Smart Account needs ETH, and the EntryPoint deposit must be sufficient for handleOps gas. You can refill it on the Gas Tank page.
        </div>
      </div>
    </Layout>
  )
}