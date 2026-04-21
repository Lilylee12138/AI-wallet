import Layout from '../components/Layout'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { getHistory, type HistoryItem } from '../lib/history'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

type SwapQuoteResponse = {
  bestRoute: {
    estimatedGas: number
    gasCostEth: string
    gasCostUsdApprox: string
  }
}

const API_BASE = 'http://127.0.0.1:8787'

function formatTime(ts: string | number) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export default function Trade() {
  const nav = useNavigate()
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])

  async function loadWalletHistory() {
    try {
      const p = getInjectedProvider()
      await requestAccounts(p)

      const chainId = await getChainId(p)
      const dep = await loadDeployments(chainId)

      setHistory(getHistory(chainId, dep.diamondAccount))
    } catch (e) {
      console.error('Failed to load history', e)
      setHistory([])
    }
  }

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        await loadWalletHistory()

        setLoading(true)
        setErr('')

        const res = await fetch(`${API_BASE}/swap/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenIn: 'ETH',
            tokenOut: 'GOV',
            amountIn: 0.1,
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
        console.error('Failed to load trade quote', e)
        setErr(e?.message || String(e))
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const refreshHistory = async () => {
      await loadWalletHistory()
    }

    window.addEventListener('focus', refreshHistory)
    window.addEventListener('wallet-refresh', refreshHistory as EventListener)

    return () => {
      window.removeEventListener('focus', refreshHistory)
      window.removeEventListener('wallet-refresh', refreshHistory as EventListener)
    }
  }, [])

  const gasTitle = useMemo(() => {
    if (loading) return 'Loading...'
    if (err) return 'Unavailable'
    return quote?.bestRoute?.gasCostEth || 'N/A'
  }, [loading, err, quote])

  const gasUsd = useMemo(() => {
    if (loading) return 'Reading current network fee...'
    if (err) return 'Unable to retrieve gas estimate.'
    return `≈ ${quote?.bestRoute?.gasCostUsdApprox || 'N/A'}`
  }, [loading, err, quote])

  const statusLabel = useMemo(() => {
    if (loading) return 'Syncing...'
    if (err) return 'Offline'
    return 'Ready'
  }, [loading, err])

  return (
    <Layout title='Transfer & Swap'>
      <div className='card' style={{ padding: 16 }}>
        <div className='row' style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className='small'>Estimated network fee</div>
            <div className='h2'>{gasTitle}</div>
            <div className='small' style={{ marginTop: 6, opacity: 0.72 }}>
              {gasUsd}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div className='small'>Status</div>
            <div className='h2'>{statusLabel}</div>
          </div>
        </div>

        <div className='row g12' style={{ marginTop: 16 }}>
          <button
            className='btn btnPrimary'
            style={{ flex: 1 }}
            onClick={() => nav('/action/transfer')}
          >
            Send
          </button>
          <button
            className='btn btnGhost'
            style={{ flex: 1 }}
            onClick={() => nav('/action/swap')}
          >
            Swap
          </button>
        </div>
      </div>

      <div className='card'>
        <div className='h2'>History</div>

        {history.length === 0 && (
          <div className='small' style={{ marginTop: 8 }}>
            No recent activity
          </div>
        )}

        {history.slice(0, 5).map((h, i) => (
          <div
            key={i}
            style={{
              marginTop: 12,
              paddingTop: i === 0 ? 0 : 12,
              borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,.06)',
            }}
          >
            {h.type === 'swap' && (
              <>
                <div className='small' style={{ fontWeight: 700 }}>
                  Swap {h.tokenIn} → {h.tokenOut}
                </div>

                <div className='small' style={{ marginTop: 4 }}>
                  {h.amountIn} → {h.amountOut}
                </div>
              </>
            )}

            {h.type === 'transfer' && (
              <>
                <div className='small' style={{ fontWeight: 700 }}>
                  Send {h.tokenIn}
                </div>

                <div className='small' style={{ marginTop: 4 }}>
                  {h.amountIn} to {h.to?.slice(0, 6)}...
                </div>
              </>
            )}

            <div className='small' style={{ marginTop: 4, opacity: 0.7 }}>
              {formatTime(h.time)}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  )
}