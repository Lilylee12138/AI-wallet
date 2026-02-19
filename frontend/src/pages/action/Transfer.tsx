import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'

export default function ActionTransfer() {
  const nav = useNavigate()

  return (
    <Layout title='Send'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Transfer</div>
        <div className='small' style={{ marginTop: 8 }}>
          预留：后续这里构造 UserOp（execute to recipient）
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <input className='input' placeholder='Recipient address (0x...)' />
          <input className='input' placeholder='Amount (ETH)' />
          <button className='btn btnPrimary' disabled>
            Send (AA UserOp) — TODO
          </button>
          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>
      </div>
    </Layout>
  )
}
