import { useCallback, useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import GasTankCard from '../components/GasTankCard'
import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

type TokenBalances = {
  ETH: string
  GOV: string
  USD: string
  WETH: string
}

type RiskStatus = {
  engine?: string
  model?: string
  oracle?: string
  risk_level?: string
}

type GasTankSummary = {
  depositEth: string
  status: 'empty' | 'low' | 'ready'
  smartAccountEth: string
}

function fmt(v: string) {
  const n = Number(v || '0')
  if (!Number.isFinite(n)) return '0.0000'
  return n.toFixed(4)
}

function shortAddr(v: string, left = 6, right = 4) {
  if (!v) return '-'
  if (v.length <= left + right + 3) return v
  return `${v.slice(0, left)}...${v.slice(-right)}`
}

function riskColor(level?: string) {
  const s = String(level || '').toUpperCase()
  if (s === 'HIGH') return 'rgba(255,77,90,.95)'
  if (s === 'MEDIUM') return 'rgba(255,196,77,.95)'
  return 'var(--green)'
}

function riskLabel(level?: string, hasStatus?: boolean) {
  const s = String(level || '').toUpperCase()
  if (!hasStatus) return 'Checking...'
  if (s === 'HIGH') return 'High Risk'
  if (s === 'MEDIUM') return 'Protected'
  return 'Secure'
}

function gasStatusColor(status?: 'empty' | 'low' | 'ready') {
  if (status === 'empty') return 'rgba(255,77,90,.95)'
  if (status === 'low') return 'rgba(255,196,77,.95)'
  return 'var(--green)'
}

function gasStatusLabel(status?: 'empty' | 'low' | 'ready') {
  if (status === 'empty') return 'Gas Tank Empty'
  if (status === 'low') return 'Gas Tank Low'
  if (status === 'ready') return 'Gas Tank Ready'
  return 'Checking Gas Tank'
}

function gasStatusHint(status?: 'empty' | 'low' | 'ready') {
  if (status === 'empty') return 'Please deposit ETH before sending AA transactions'
  if (status === 'low') return 'Top up soon to avoid failed AA transactions'
  if (status === 'ready') return 'Gas Tank funded and ready for AA transactions'
  return 'Loading Gas Tank status...'
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

export default function Dashboard() {
  const [diamond, setDiamond] = useState('')
  const [bal, setBal] = useState('0')
  const [tokens, setTokens] = useState<TokenBalances>({
    ETH: '0',
    GOV: '0',
    USD: '0',
    WETH: '0',
  })

  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [showGasTank, setShowGasTank] = useState(false)
  const [showFullSmartAccount, setShowFullSmartAccount] = useState(false)
  const [copied, setCopied] = useState(false)

  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null)
  const [gasTankSummary, setGasTankSummary] = useState<GasTankSummary | null>(null)

  const refreshBalances = useCallback(async () => {
    try {
      setRefreshing(true)
      setErr('')

      const p = getInjectedProvider()
      await requestAccounts(p)

      const chainId = await getChainId(p)
      const dep = await loadDeployments(chainId)

      setDiamond(dep.diamondAccount)

      const ethBal = await p.getBalance(dep.diamondAccount)
      const eth = ethers.utils.formatEther(ethBal)
      setBal(eth)

      const next: TokenBalances = {
        ETH: eth,
        GOV: '0',
        USD: '0',
        WETH: '0',
      }

      const tokenMap = dep.tokens || {}

      for (const sym of ['GOV', 'USD', 'WETH'] as const) {
        const tokenAddr = tokenMap[sym]
        if (!tokenAddr) continue

        const token = new ethers.Contract(tokenAddr, ERC20_ABI, p)
        const [raw, decimals] = await Promise.all([
          token.balanceOf(dep.diamondAccount),
          token.decimals(),
        ])

        next[sym] = ethers.utils.formatUnits(raw, decimals)
      }

      setBal(eth)
      setTokens(next)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  const refreshRiskStatus = useCallback(async () => {
    try {
      const r = await fetch('http://127.0.0.1:8787/risk/status')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRiskStatus(j)
    } catch (e) {
      console.error(e)
      setRiskStatus(null)
    }
  }, [])

  useEffect(() => {
    refreshBalances()
    refreshRiskStatus()
  }, [refreshBalances, refreshRiskStatus])

  useEffect(() => {
    const onFocus = () => {
      refreshBalances()
      refreshRiskStatus()
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshBalances, refreshRiskStatus])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshBalances()
      refreshRiskStatus()
    }, 8000)

    return () => window.clearInterval(timer)
  }, [refreshBalances, refreshRiskStatus])

  const totalBalanceText = useMemo(() => fmt(tokens.ETH), [tokens.ETH])

  const currentRiskColor = riskColor(riskStatus?.risk_level)
  const currentGasColor = gasStatusColor(gasTankSummary?.status)

  return (
    <Layout title='Main Wallet'>
      {err && (
        <div
          className='card'
          style={{
            padding: 12,
            marginBottom: 12,
            borderColor: 'rgba(255,77,90,.42)',
            background: 'rgba(255,77,90,.08)',
          }}
        >
          <div
            className='small'
            style={{ color: 'rgba(255,120,130,.98)', fontWeight: 800 }}
          >
            Error
          </div>
          <div className='small' style={{ marginTop: 6 }}>
            {err}
          </div>
        </div>
      )}

      <div
        className='card'
        style={{
          padding: 16,
          background: 'linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01))',
        }}
      >
        <div
          className='row'
          style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}
        >
          <div>
            <div className='small' style={{ opacity: 0.72 }}>
              Total Balance
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 34,
                lineHeight: 1,
                fontWeight: 900,
                letterSpacing: '-0.03em',
              }}
            >
              {totalBalanceText} ETH
            </div>
            <div className='small' style={{ marginTop: 8, opacity: 0.68 }}>
              Smart wallet overview
            </div>
          </div>

          <button
            className='btn btnGhost'
            style={{ padding: '8px 14px', minWidth: 0 }}
            onClick={() => {
              refreshBalances()
              refreshRiskStatus()
            }}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
          }}
        >
          <div
            className='cardSoft'
            style={{
              padding: 12,
              border: `1px solid ${currentRiskColor}26`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: currentRiskColor,
                  boxShadow: `0 0 10px ${currentRiskColor}`,
                  flexShrink: 0,
                }}
              />
              <div className='small' style={{ opacity: 0.72 }}>AI Protection</div>
            </div>

            <div
              style={{
                marginTop: 8,
                color: currentRiskColor,
                fontWeight: 900,
                fontSize: 18,
              }}
            >
              {riskLabel(riskStatus?.risk_level, !!riskStatus)}
            </div>

            <div className='small' style={{ marginTop: 6, opacity: 0.75 }}>
              {riskStatus
                ? 'Risk engine and oracle monitoring are active'
                : 'Checking risk services...'}
            </div>
          </div>

          <button
            className='cardSoft'
            style={{
              padding: 12,
              border: `1px solid ${currentGasColor}26`,
              textAlign: 'left',
              cursor: 'pointer',
              background: 'rgba(255,255,255,.03)',
            }}
            onClick={() => setShowGasTank(v => !v)}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: currentGasColor,
                  boxShadow: `0 0 10px ${currentGasColor}`,
                  flexShrink: 0,
                }}
              />
              <div className='small' style={{ opacity: 0.72 }}>Gas Tank</div>
            </div>

            <div
              style={{
                marginTop: 8,
                color: currentGasColor,
                fontWeight: 900,
                fontSize: 18,
              }}
            >
              {gasStatusLabel(gasTankSummary?.status)}
            </div>

            <div className='small' style={{ marginTop: 6, opacity: 0.75, lineHeight: 1.45 }}>
              {gasStatusHint(gasTankSummary?.status)}
            </div>

            <div className='small' style={{ marginTop: 8, fontWeight: 700 }}>
              Deposit: {gasTankSummary?.depositEth || '0.0000'} ETH {showGasTank ? '▲' : '▼'}
            </div>
          </button>
        </div>

        <button
          className='cardSoft'
          style={{
            marginTop: 10,
            width: '100%',
            padding: 14,
            textAlign: 'left',
            cursor: 'pointer',
            background: 'rgba(255,255,255,.03)',
          }}
          onClick={() => setShowFullSmartAccount(v => !v)}
          title={diamond || '-'}
        >
          <div className='small' style={{ opacity: 0.72 }}>
            Smart Account
          </div>

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
              style={{
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.92)',
                letterSpacing: '0.02em',
                wordBreak: 'break-all',
                lineHeight: 1.4,
                flex: 1,
              }}
            >
              {diamond
                ? showFullSmartAccount
                  ? diamond
                  : shortAddr(diamond, 8, 6)
                : 'Loading...'}
            </div>

            <button
              type='button'
              onClick={async (e) => {
                e.stopPropagation()
                if (!diamond) return
                await copyText(diamond)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1200)
              }}
              title='Copy address'
              aria-label='Copy smart wallet address'
              style={{
                flexShrink: 0,
                width: 34,
                height: 34,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.08)',
                background: 'rgba(255,255,255,.04)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,.82)',
                cursor: 'pointer',
              }}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect
                  x='9'
                  y='9'
                  width='10'
                  height='10'
                  rx='2'
                  stroke='currentColor'
                  strokeWidth='1.8'
                />
                <path
                  d='M7 15H6C4.89543 15 4 14.1046 4 13V6C4 4.89543 4.89543 4 6 4H13C14.1046 4 15 4.89543 15 6V7'
                  stroke='currentColor'
                  strokeWidth='1.8'
                  strokeLinecap='round'
                />
              </svg>
            </button>
          </div>

          <div className='small' style={{ marginTop: 6, opacity: 0.6 }}>
            {copied
              ? 'Address copied'
              : showFullSmartAccount
                ? 'Tap to hide full address'
                : 'Tap to show full address'}
          </div>
        </button>
      </div>

      {showGasTank && (
        <div style={{ marginTop: 12 }}>
          {diamond && (
            <GasTankCard
              diamondAccount={diamond}
              onStatusChange={(info) => setGasTankSummary(info)}
            />
          )}
        </div>
      )}

      {!showGasTank && diamond && (
        <div style={{ display: 'none' }}>
          <GasTankCard
            diamondAccount={diamond}
            onStatusChange={(info) => setGasTankSummary(info)}
          />
        </div>
      )}

      <div className='card' style={{ marginTop: 12, padding: 14 }}>
        <div
          className='row'
          style={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div className='h2'>Assets</div>
          <div className='small' style={{ opacity: 0.68 }}>
            Wallet token balances
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
          }}
        >
          <div
            className='cardSoft'
            style={{
              padding: 12,
              border: '1px solid rgba(90,255,210,.12)',
              background: 'linear-gradient(180deg, rgba(90,255,210,.08), rgba(255,255,255,.02))',
            }}
          >
            <div className='small'>ETH</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900 }}>
              {fmt(tokens.ETH)}
            </div>
          </div>

          <div className='cardSoft' style={{ padding: 12 }}>
            <div className='small'>GOV</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900 }}>
              {fmt(tokens.GOV)}
            </div>
          </div>

          <div className='cardSoft' style={{ padding: 12 }}>
            <div className='small'>USD</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900 }}>
              {fmt(tokens.USD)}
            </div>
          </div>

          <div className='cardSoft' style={{ padding: 12 }}>
            <div className='small'>WETH</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900 }}>
              {fmt(tokens.WETH)}
            </div>
          </div>
        </div>

      </div>
    </Layout>
  )
}