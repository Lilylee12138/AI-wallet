import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'

import { getInjectedProvider, requestAccounts, getChainId } from '../../lib/eth'
import { loadDeployments } from '../../config/deployments'
import { buildUserOp, signUserOpEOA, sendUserOp } from '../../lib/aa'
import { appendHistory } from '../../lib/history'

const API_BASE = 'http://127.0.0.1:8787'

const EXEC_ABI = [
  'function execute(address target,uint256 value,bytes data)'
]

const ROUTER_ABI = [
  'function swapExactETHForTokens(uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) payable returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to) returns (uint256[] memory amounts)',
]

const ERC20_ABI = [
  'function approve(address spender,uint256 amount) returns (bool)',
]

type TokenSymbol = 'ETH' | 'GOV' | 'USD'

type SwapQuoteResponse = {
  input: {
    tokenIn: string
    tokenOut: string
    amountIn: number
  }
  routes: Array<{
    name: string
    path: string[]
    amountIn: string
    amountOut: string
    amountOutRaw: string
    effectiveRate: string
    priceImpactPct: string
    estimatedGas: number
    gasCostEth: string
    gasCostUsdApprox: string
    recommendedSlippagePct: string
    minimumReceived: string
    aiExplanation: string
    compositeScore: number
  }>
  bestRoute: {
    name: string
    path: string[]
    amountIn: string
    expectedOut: string
    amountOutRaw: string
    effectiveRate: string
    priceImpact: string
    estimatedGas: number
    gasCostEth: string
    gasCostUsdApprox: string
    recommendedSlippage: string
    minimumReceived: string
    aiExplanation: string
  }
}

function routeNameToRouter(dep: any, routeName: string) {
  if (routeName.includes('DEX2')) return dep.dex.DEX2Router
  return dep.dex.DEX1Router
}

function symbolToAddress(sym: string, dep: any) {
  if (sym === 'ETH') return dep.tokens.WETH
  return dep.tokens[sym]
}

function presetToDisplay(v: string) {
  if (v === 'auto') return 'Auto'
  return `${v}%`
}

function isDepositIssue(msg: string) {
  const s = String(msg || '').toLowerCase()
  return (
    s.includes('deposit') ||
    s.includes('entrypoint') ||
    s.includes("aa21 didn't pay prefund") ||
    s.includes('prefund')
  )
}

function mapFriendlySwapError(raw: string) {
  const msg = String(raw || '')

  if (msg.includes("AA21 didn't pay prefund")) {
    return {
      title: 'Not enough gas prefund',
      message:
        'This swap could not be submitted because the smart wallet does not have enough prefund for the ERC-4337 operation. Please add more ETH to the wallet or deposit more ETH into the EntryPoint gas tank, then try again.'
    }
  }

  if (msg.includes('MetaMask not connected')) {
    return {
      title: 'Wallet not connected',
      message:
        'Your wallet is not connected. Please connect MetaMask first, then try again.'
    }
  }

  if (msg.includes('Amount must be > 0')) {
    return {
      title: 'Invalid swap amount',
      message:
        'The swap amount must be greater than zero.'
    }
  }

  if (msg.includes('No quote available')) {
    return {
      title: 'No quote available',
      message:
        'The wallet could not generate a valid swap quote for the current token pair and amount. Please adjust the amount or try another token pair.'
    }
  }

  if (msg.includes('Current real execution supports')) {
    return {
      title: 'Pair not supported for execution',
      message:
        'This token combination can be analyzed by the quote engine, but real on-chain execution is not enabled yet for this route.'
    }
  }

  if (msg.includes('user rejected') || msg.includes('User denied')) {
    return {
      title: 'Transaction cancelled',
      message:
        'The swap transaction was cancelled in the wallet before it was submitted.'
    }
  }

  if (msg.includes('reverted')) {
    return {
      title: 'Swap reverted',
      message:
        'The swap transaction was submitted but reverted during execution. This may happen because of insufficient prefund, slippage conditions, approval issues, or route execution problems.'
    }
  }

  return {
    title: 'Swap failed',
    message:
      'The swap could not be completed. Please check the quote, amount, supported token pair, wallet balance, and EntryPoint gas tank balance, then try again.'
  }
}

function shortenError(raw: string) {
  const text = String(raw || '')
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

export default function ActionSwap() {
  const nav = useNavigate()

  const [dep, setDep] = useState<any>(null)

  const [tokenIn, setTokenIn] = useState<TokenSymbol>('ETH')
  const [tokenOut, setTokenOut] = useState<TokenSymbol>('GOV')
  const [amountIn, setAmountIn] = useState('0.1')

  const [slippageMode, setSlippageMode] = useState<'auto' | '0.5' | '2' | 'custom'>('auto')
  const [customSlippage, setCustomSlippage] = useState('1.0')

  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteErr, setQuoteErr] = useState('')

  const [sending, setSending] = useState(false)
  const [txMsg, setTxMsg] = useState('')
  const [txErr, setTxErr] = useState('')

  const [friendlyErrorTitle, setFriendlyErrorTitle] = useState('')
  const [friendlyErrorMessage, setFriendlyErrorMessage] = useState('')
  const [errorModalOpen, setErrorModalOpen] = useState(false)

  const [aiExplaining, setAiExplaining] = useState(false)
  const [aiReply, setAiReply] = useState('')
  const [aiErr, setAiErr] = useState('')
  const [manualExplainOpen, setManualExplainOpen] = useState(false)

  async function loadDep() {
    const p = getInjectedProvider()
    await requestAccounts(p)
    const chainId = await getChainId(p)
    const d = await loadDeployments(chainId)
    setDep(d)
    return { p, d }
  }

  function showFriendlyError(raw: string) {
    const mapped = mapFriendlySwapError(raw)
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

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setQuoteErr('')
        setTxMsg('')
        setTxErr('')
        setFriendlyErrorTitle('')
        setFriendlyErrorMessage('')
        setErrorModalOpen(false)
        setAiReply('')
        setAiErr('')
        setManualExplainOpen(false)

        const n = Number(amountIn)
        if (!Number.isFinite(n) || n <= 0) {
          setQuote(null)
          return
        }

        if (tokenIn === tokenOut) {
          setQuote(null)
          setQuoteErr('From token and To token cannot be the same.')
          return
        }

        setQuoteLoading(true)

        const res = await fetch(`${API_BASE}/swap/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenIn,
            tokenOut,
            amountIn: n,
          }),
        })

        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || `HTTP ${res.status}`)
        }

        const data: SwapQuoteResponse = await res.json()
        if (!alive) return
        setQuote(data)
      } catch (e: any) {
        if (!alive) return
        setQuote(null)
        setQuoteErr(e?.message || String(e))
      } finally {
        if (!alive) return
        setQuoteLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [tokenIn, tokenOut, amountIn])

  const isExecutable = useMemo(() => {
    if (tokenIn === 'ETH' && (tokenOut === 'GOV' || tokenOut === 'USD')) return true
    if ((tokenIn === 'GOV' || tokenIn === 'USD') && (tokenOut === 'GOV' || tokenOut === 'USD') && tokenIn !== tokenOut) {
      return true
    }
    return false
  }, [tokenIn, tokenOut])

  const effectiveSlippagePct = useMemo(() => {
    if (!quote?.bestRoute) return 0
    if (slippageMode === 'auto') {
      return Number(String(quote.bestRoute.recommendedSlippage).replace('%', '').trim())
    }
    if (slippageMode === 'custom') {
      const v = Number(customSlippage)
      return Number.isFinite(v) && v > 0 ? v : 1
    }
    return Number(slippageMode)
  }, [slippageMode, customSlippage, quote])

  const displayMinReceived = useMemo(() => {
    if (!quote?.bestRoute) return 'N/A'

    const expected = quote.bestRoute.expectedOut
    const parts = expected.split(' ')
    const amount = Number(parts[0])
    const symbol = parts[1] || tokenOut

    if (!Number.isFinite(amount)) return quote.bestRoute.minimumReceived

    const min = amount * (1 - effectiveSlippagePct / 100)
    return `${min.toFixed(4)} ${symbol}`
  }, [quote, effectiveSlippagePct, tokenOut])

  useEffect(() => {
    try {
      const contextPayload = {
        page: 'swap',
        title: 'Swap',
        path: window.location.pathname,
        context: {
          tokenIn,
          tokenOut,
          amountIn: Number(amountIn || '0'),
          slippageMode,
          slippageDisplay: presetToDisplay(slippageMode === 'custom' ? customSlippage : slippageMode),
          effectiveSlippagePct,
          bestRoute: quote?.bestRoute?.path?.join(' -> ') || '',
          expectedOut: quote?.bestRoute?.expectedOut || '',
          priceImpact: quote?.bestRoute?.priceImpact || '',
          recommendedSlippage: quote?.bestRoute?.recommendedSlippage || '',
          minimumReceived: displayMinReceived,
          gasCostEth: quote?.bestRoute?.gasCostEth || '',
          gasCostUsdApprox: quote?.bestRoute?.gasCostUsdApprox || '',
          routeExplanation: quote?.bestRoute?.aiExplanation || '',
          isExecutable,
          quoteError: quoteErr || '',
          txStatus: txErr ? 'failed' : txMsg ? 'success' : sending ? 'pending' : 'idle',
          txError: txErr || '',
          entryPointDepositIssue: isDepositIssue(txErr),
          lastErrorFriendlyTitle: friendlyErrorTitle || '',
          lastErrorFriendlyMessage: friendlyErrorMessage || ''
        }
      }

      sessionStorage.setItem('wallet_ai_context', JSON.stringify(contextPayload))
    } catch (e) {
      console.error(e)
    }
  }, [
    tokenIn,
    tokenOut,
    amountIn,
    slippageMode,
    customSlippage,
    effectiveSlippagePct,
    quote,
    quoteErr,
    displayMinReceived,
    isExecutable,
    txMsg,
    txErr,
    sending,
    friendlyErrorTitle,
    friendlyErrorMessage
  ])

  async function explainSwapWithAI(mode: 'manual' | 'error' = 'manual') {
    if (!quote?.bestRoute && !txErr && !quoteErr) return

    setAiErr('')
    setAiExplaining(true)

    try {
      const context = {
        tokenIn,
        tokenOut,
        amountIn: Number(amountIn || '0'),
        slippageMode,
        effectiveSlippagePct,
        bestRoute: quote?.bestRoute?.path?.join(' -> ') || '',
        expectedOut: quote?.bestRoute?.expectedOut || '',
        priceImpact: quote?.bestRoute?.priceImpact || '',
        recommendedSlippage: quote?.bestRoute?.recommendedSlippage || '',
        minimumReceived: displayMinReceived,
        gasCostEth: quote?.bestRoute?.gasCostEth || '',
        gasCostUsdApprox: quote?.bestRoute?.gasCostUsdApprox || '',
        routeExplanation: quote?.bestRoute?.aiExplanation || '',
        isExecutable,
        quoteError: quoteErr || '',
        txStatus: txErr ? 'failed' : txMsg ? 'success' : sending ? 'pending' : 'idle',
        txError: txErr || '',
        entryPointDepositIssue: isDepositIssue(txErr),
        lastErrorFriendlyTitle: friendlyErrorTitle || '',
        lastErrorFriendlyMessage: friendlyErrorMessage || ''
      }

      let message =
        'Please explain this swap quote in a gentle, beginner-friendly way. Explain why this route is selected, what price impact means, why the recommended slippage is set this way, what minimum received means, and what the user should pay attention to.'

      if (mode === 'error' || txErr) {
        message =
          'Please explain this failed swap in a gentle, beginner-friendly way. Explain what likely went wrong, what the error means, and what the user should check next.'
      }

      const r = await fetch('http://127.0.0.1:8787/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          page: 'swap',
          context,
          history: []
        })
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail || j?.error || 'llm chat error')

      setAiReply(j?.reply || '')
      setManualExplainOpen(true)
    } catch (e: any) {
      setAiErr(e?.message || String(e))
      setManualExplainOpen(true)
    } finally {
      setAiExplaining(false)
    }
  }

  async function runUserOp(params: {
    provider: ethers.providers.Web3Provider
    entryPoint: string
    diamond: string
    beneficiary: string
    callData: string
  }) {
    const { provider, entryPoint, diamond, beneficiary, callData } = params

    const { userOp, userOpHash } = await buildUserOp({
      provider,
      entryPoint,
      diamond,
      callData,
    })

    userOp.signature = await signUserOpEOA({
      provider,
      userOpHash,
    })

    const result = await sendUserOp({
      provider,
      entryPoint,
      beneficiary,
      userOp,
      userOpHash,
    })

    if (result?.success === false) {
      throw new Error(result?.revertReason || 'UserOp reverted')
    }

    return result
  }

  async function swap() {
    setTxMsg('')
    setTxErr('')
    setFriendlyErrorTitle('')
    setFriendlyErrorMessage('')
    setErrorModalOpen(false)
    setAiReply('')
    setAiErr('')
    setManualExplainOpen(false)
    setSending(true)

    try {
      const { p, d } = await loadDep()

      if (!quote?.bestRoute) throw new Error('No quote available')
      if (!isExecutable) {
        throw new Error('Current real execution supports ETH -> GOV/USD and GOV <-> USD only')
      }

      const router = routeNameToRouter(d, quote.bestRoute.name)
      const path = quote.bestRoute.path.map((sym) => symbolToAddress(sym, d))
      const expectedOutRaw = ethers.BigNumber.from(quote.bestRoute.amountOutRaw)
      const slippageBps = Math.floor(effectiveSlippagePct * 100)
      const amountOutMin = expectedOutRaw.mul(10000 - slippageBps).div(10000)
      const deadline = Math.floor(Date.now() / 1000) + 60 * 10

      const accounts = await p.listAccounts()
      if (!accounts.length) throw new Error('MetaMask not connected')
      const beneficiary = accounts[0]

      const execIface = new ethers.utils.Interface(EXEC_ABI)
      const routerIface = new ethers.utils.Interface(ROUTER_ABI)

      if (tokenIn === 'ETH') {
        const value = ethers.utils.parseEther(amountIn)
        if (value.lte(0)) throw new Error('Amount must be > 0')

        const innerData = routerIface.encodeFunctionData('swapExactETHForTokens', [
          amountOutMin,
          path,
          d.diamondAccount,
          deadline,
        ])

        const callData = execIface.encodeFunctionData('execute', [
          router,
          value,
          innerData,
        ])

        const result = await runUserOp({
          provider: p,
          entryPoint: d.entryPoint,
          diamond: d.diamondAccount,
          beneficiary,
          callData,
        })

        const txHash =
          result?.receipt?.transactionHash ||
          result?.receipt?.hash ||
          'submitted'
        
        //添加交易记录
        const chainId = await getChainId(p)
        appendHistory(
          chainId,
          d.diamondAccount,
          {
            id: Date.now().toString(),
            type: 'swap',
            time: Date.now(),
            tokenIn,
            tokenOut,
            amountIn,
            amountOut: quote?.bestRoute?.expectedOut,
            txHash
          }
        )

        setTxMsg(`Swap success. tx=${txHash}`)
      } else {
        const amountInWei = ethers.utils.parseEther(amountIn)
        if (amountInWei.lte(0)) throw new Error('Amount must be > 0')

        const tokenInAddr = symbolToAddress(tokenIn, d)

        const tokenIface = new ethers.utils.Interface(ERC20_ABI)
        const approveData = tokenIface.encodeFunctionData('approve', [router, amountInWei])

        const approveCallData = execIface.encodeFunctionData('execute', [
          tokenInAddr,
          0,
          approveData,
        ])

        await runUserOp({
          provider: p,
          entryPoint: d.entryPoint,
          diamond: d.diamondAccount,
          beneficiary,
          callData: approveCallData,
        })

        const swapData = routerIface.encodeFunctionData('swapExactTokensForTokens', [
          amountInWei,
          amountOutMin,
          path,
          d.diamondAccount,
        ])

        const swapCallData = execIface.encodeFunctionData('execute', [
          router,
          0,
          swapData,
        ])

        const result = await runUserOp({
          provider: p,
          entryPoint: d.entryPoint,
          diamond: d.diamondAccount,
          beneficiary,
          callData: swapCallData,
        })

        const txHash =
          result?.receipt?.transactionHash ||
          result?.receipt?.hash ||
          'submitted'

        setTxMsg(`Token swap success. tx=${txHash}`)
      }

      window.dispatchEvent(new Event('wallet-refresh'))
    } catch (e: any) {
      const raw = e?.shortMessage || e?.reason || e?.message || String(e)
      showFriendlyError(raw)
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout title='Swap'>
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
                {friendlyErrorTitle || 'Swap failed'}
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
                  await explainSwapWithAI('error')
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

      <div className='card' style={{ padding: 16 }}>
        <div className='row' style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className='h2'>Swap</div>
          <div className='small'>Slippage: {presetToDisplay(slippageMode === 'custom' ? customSlippage : slippageMode)}</div>
        </div>

        <div className='cardSoft' style={{ marginTop: 14, padding: 14 }}>
          <div className='small'>From token</div>
          <select
            className='input'
            value={tokenIn}
            onChange={(e) => setTokenIn(e.target.value as TokenSymbol)}
            style={{ marginTop: 8 }}
          >
            <option value='ETH'>ETH</option>
            <option value='GOV'>GOV</option>
            <option value='USD'>USD</option>
          </select>

          <div className='small' style={{ marginTop: 12 }}>To token</div>
          <select
            className='input'
            value={tokenOut}
            onChange={(e) => setTokenOut(e.target.value as TokenSymbol)}
            style={{ marginTop: 8 }}
          >
            <option value='ETH'>ETH</option>
            <option value='GOV'>GOV</option>
            <option value='USD'>USD</option>
          </select>

          <div className='small' style={{ marginTop: 12 }}>Amount</div>
          <input
            className='input'
            placeholder='0.1'
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            style={{ marginTop: 8 }}
          />
        </div>

        <div className='cardSoft' style={{ marginTop: 14, padding: 14 }}>
          <div className='small'>Slippage tolerance</div>

          <div className='row g12' style={{ marginTop: 10 }}>
            <button className='btn btnGhost' onClick={() => setSlippageMode('auto')}>
              Auto
            </button>
            <button className='btn btnGhost' onClick={() => setSlippageMode('0.5')}>
              0.5%
            </button>
            <button className='btn btnGhost' onClick={() => setSlippageMode('2')}>
              2%
            </button>
            <button className='btn btnGhost' onClick={() => setSlippageMode('custom')}>
              Custom
            </button>
          </div>

          {slippageMode === 'custom' && (
            <input
              className='input'
              style={{ marginTop: 10 }}
              placeholder='1.0'
              value={customSlippage}
              onChange={(e) => setCustomSlippage(e.target.value)}
            />
          )}
        </div>

        <div className='cardSoft' style={{ marginTop: 14, padding: 14 }}>
          <div className='small'>Quote</div>

          {quoteLoading ? (
            <div className='small' style={{ marginTop: 8 }}>
              Analyzing optimal path, slippage, and gas costs...
            </div>
          ) : quoteErr ? (
            <div className='small' style={{ marginTop: 8, color: 'rgba(255,77,90,.9)' }}>
              {quoteErr}
            </div>
          ) : quote?.bestRoute ? (
            <>
              <div className='small' style={{ marginTop: 8 }}>
                Best route: {quote.bestRoute.path.join(' -> ')}
              </div>
              <div className='small'>Expected out: {quote.bestRoute.expectedOut}</div>
              <div className='small'>Price impact: {quote.bestRoute.priceImpact}</div>
              <div className='small'>Recommended slippage: {quote.bestRoute.recommendedSlippage}</div>
              <div className='small'>Minimum received: {displayMinReceived}</div>
              <div className='small'>
                Gas cost: {quote.bestRoute.gasCostEth} / {quote.bestRoute.gasCostUsdApprox}
              </div>
              <div className='small' style={{ marginTop: 8 }}>
                {quote.bestRoute.aiExplanation}
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  className='btn btnGhost'
                  onClick={() => explainSwapWithAI('manual')}
                  disabled={aiExplaining}
                >
                  {aiExplaining ? 'Explaining…' : 'Explain this route with AI'}
                </button>
              </div>

              {manualExplainOpen && aiReply && !txErr && (
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

              {aiErr && !txErr && (
                <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>
                  AI explain error: {aiErr}
                </div>
              )}
            </>
          ) : (
            <div className='small' style={{ marginTop: 8 }}>
              请输入有效的 token 和 amount。
            </div>
          )}
        </div>

        <div className='small' style={{ marginTop: 12, opacity: 0.85 }}>
          {tokenIn === 'ETH'
            ? 'This pair supports real ETH-origin AA swaps (the router will automatically wrap ETH to WETH).'
            : isExecutable
            ? 'This pair supports real token-to-token AA swaps (the wallet will execute approve first, then perform the swap).'
            : 'This pair currently supports AI quote analysis only. Real execution can be extended to token-to-ETH swaps in future versions.'}
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <button
            className='btn btnPrimary'
            disabled={sending || quoteLoading || !quote?.bestRoute || !isExecutable}
            onClick={swap}
          >
            {sending ? 'Swapping…' : 'Swap (AA UserOp)'}
          </button>

          {txMsg && (
            <div style={{ marginTop: 10, color: 'var(--green)' }}>
              {txMsg}
            </div>
          )}

          {txErr && (
            <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>
              {txErr}
            </div>
          )}

          {txErr && manualExplainOpen && aiReply && (
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

          {txErr && aiErr && (
            <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>
              AI explain error: {aiErr}
            </div>
          )}

          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>
      </div>
    </Layout>
  )
}