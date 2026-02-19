import Layout from '../components/Layout'
import { useNavigate } from 'react-router-dom'

export default function Trade() {
  const nav = useNavigate()

  return (
    <Layout title='Transfer & Swap'>
      <div className='card' style={{ padding: 16 }}>
        <div className='row' style={{ justifyContent: 'space-between' }}>
          <div>
            <div className='small'>Gas</div>
            <div className='h2'>LOW • (placeholder)</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className='small'>Swap rate</div>
            <div className='h2'>ETH/USDT (placeholder)</div>
          </div>
        </div>

        <div className='cardSoft' style={{ marginTop: 14, padding: 14 }}>
          <div className='small'>AI Smart Assistant（预留）</div>
          <div className='small'>后续接入：基于 gas/swap API 进行解释与建议</div>
        </div>

        <div className='row g12' style={{ marginTop: 14 }}>
          <button className='btn btnPrimary' style={{ flex: 1 }} onClick={() => nav('/action/transfer')}>
            Send
          </button>
          <button className='btn btnGhost' style={{ flex: 1 }} onClick={() => nav('/action/swap')}>
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
