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

  const gasSubtitle = useMemo(() => {
    if (loading) return 'Reading current on-chain transaction cost...'
    if (err) return 'Unable to retrieve network gas information.'
    return `≈ ${quote?.bestRoute?.gasCostUsdApprox || 'N/A'}`
  }, [loading, err, quote])

  const assistantText = useMemo(() => {
    if (loading) {
      return 'AI is analyzing the current network conditions and transaction environment...'
    }
    if (err) {
      return 'AI is currently unable to retrieve on-chain quote data. Please try again later.'
    }
    return 'AI has completed the transaction environment analysis. Navigate to the Send or Swap page to view detailed costs, paths, and recommendations for each operation.'
  }, [loading, err])

  return (
    <Layout title='Transfer & Swap'>
      <div className='card' style={{ padding: 16 }}>
        <div className='row' style={{ justifyContent: 'space-between' }}>
          <div>
            <div className='small'>Network gas</div>
            <div className='h2'>{gasTitle}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className='small'>Status</div>
            <div className='h2'>
              {loading ? 'Syncing...' : err ? 'Offline' : 'Ready'}
            </div>
          </div>
        </div>

        <div className='cardSoft' style={{ marginTop: 14, padding: 14 }}>
          <div className='small'>{assistantText}</div>
          <div className='small' style={{ marginTop: 8 }}>
            {gasSubtitle}
          </div>
        </div>

        <div className='row g12' style={{ marginTop: 14 }}>
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
          <div key={i} style={{ marginTop: 12 }}>
            {h.type === 'swap' && (
              <>
                <div className='small' style={{ fontWeight: 600 }}>
                  {i + 1}. Swap {h.tokenIn} → {h.tokenOut}
                </div>

                <div className='small'>
                  {h.amountIn} → {h.amountOut}
                </div>
              </>
            )}

            {h.type === 'transfer' && (
              <>
                <div className='small' style={{ fontWeight: 600 }}>
                  {i + 1}. Send {h.tokenIn}
                </div>

                <div className='small'>
                  {h.amountIn} to {h.to?.slice(0, 6)}...
                </div>
              </>
            )}

            <div className='small' style={{ opacity: 0.7 }}>
              {new Date(h.time).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  )
}