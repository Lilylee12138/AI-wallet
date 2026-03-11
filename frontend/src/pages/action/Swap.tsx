import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'

import { getInjectedProvider, requestAccounts, getChainId } from '../../lib/eth'
import { loadDeployments } from '../../config/deployments'
import { buildUserOp, signUserOpEOA, sendUserOp } from '../../lib/aa'

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

function pctStringToBps(s: string) {
  const n = Number(String(s).replace('%', '').trim())
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n * 100)
}

function presetToDisplay(v: string) {
  if (v === 'auto') return 'Auto'
  return `${v}%`
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

  async function loadDep() {
    const p = getInjectedProvider()
    await requestAccounts(p)
    const chainId = await getChainId(p)
    const d = await loadDeployments(chainId)
    setDep(d)
    return { p, d }
  }

  useEffect(() => {
    ;(async () => {
      try {
        await loadDep()
      } catch (e: any) {
        setTxErr(e?.message || String(e))
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

      // ETH -> token
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

        setTxMsg(`Swap success. tx=${txHash}`)
      } else {
        // token -> token
        const amountInWei = ethers.utils.parseEther(amountIn)
        if (amountInWei.lte(0)) throw new Error('Amount must be > 0')

        const tokenInAddr = symbolToAddress(tokenIn, d)

        // 1) approve(router, amount)
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

        // 2) swapExactTokensForTokens(amountIn, amountOutMin, path, diamondAccount)
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
      setTxErr(e?.shortMessage || e?.reason || e?.message || String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout title='Swap'>
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
              正在分析最优路径、滑点与 gas 成本...
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
            </>
          ) : (
            <div className='small' style={{ marginTop: 8 }}>
              请输入有效的 token 和 amount。
            </div>
          )}
        </div>

        <div className='small' style={{ marginTop: 12, opacity: 0.85 }}>
          {tokenIn === 'ETH'
            ? '当前组合支持真实 ETH-origin AA swap（Router 内部会自动 wrap ETH -> WETH）。'
            : isExecutable
            ? '当前组合支持真实 token-to-token AA swap（会先通过 AA 执行 approve，再执行 swap）。'
            : '当前页面已支持该组合的 AI quote 展示；真实执行下一步可继续扩展 token-to-ETH。'}
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

          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>
      </div>
    </Layout>
  )
}