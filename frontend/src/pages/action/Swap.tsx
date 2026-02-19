import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'

export default function ActionSwap() {
  const nav = useNavigate()

  return (
    <Layout title='Swap'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Swap</div>
        <div className='small' style={{ marginTop: 8 }}>
          预留：后续接公共 swap API + 路由到 DEX/Router，并用 AA 发起交易
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <select className='select'>
            <option>USDT → ETH</option>
            <option>ETH → USDT</option>
          </select>
          <input className='input' placeholder='Amount' />
          <button className='btn btnPrimary' disabled>
            Swap (AA UserOp) — TODO
          </button>
          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>
      </div>
    </Layout>
  )
}
