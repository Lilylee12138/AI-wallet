import Layout from '../components/Layout'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'

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

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
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

  const gasTitle = useMemo(() => {
    if (loading) return 'Loading...'
    if (err) return 'Unavailable'
    return quote?.bestRoute?.gasCostEth || 'N/A'
  }, [loading, err, quote])

  const gasSubtitle = useMemo(() => {
    if (loading) return '正在读取当前链上交易成本...'
    if (err) return '暂时无法获取网络 gas 信息'
    return `≈ ${quote?.bestRoute?.gasCostUsdApprox || 'N/A'}`
  }, [loading, err, quote])

  const assistantText = useMemo(() => {
    if (loading) return 'AI 正在分析当前网络状态与交易环境...'
    if (err) return 'AI 暂时无法获取链上报价数据，请稍后重试。'
    return 'AI 已完成交易环境分析。进入 Send 或 Swap 页面可查看对应操作的详细成本、路径与建议。'
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

      <div className='card' style={{ marginTop: 14, padding: 16 }}>
        <div className='h2'>History</div>
        <div className='small' style={{ marginTop: 8 }}>
          预留：后续接入交易历史（本地缓存 + 链上事件索引）
        </div>
      </div>
    </Layout>
  )
}