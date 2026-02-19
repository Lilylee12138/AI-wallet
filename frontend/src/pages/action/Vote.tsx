import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../../components/Layout'

export default function ActionVote() {
  const nav = useNavigate()
  const { id } = useParams()
  const pid = Number(id || 0)

  const [support, setSupport] = useState('1')

  return (
    <Layout title='Vote'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Vote on Proposal #{pid}</div>
        <div className='small' style={{ marginTop: 8 }}>
          预留：后续这里用 AA/4337 从 Smart Account 发起 castVote(proposalId, support)
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <select className='select' value={support} onChange={(e) => setSupport(e.target.value)}>
            <option value='1'>Approve / For</option>
            <option value='2'>Reject / Against</option>
            <option value='3'>Abstain</option>
          </select>

          <button className='btn btnPrimary' disabled>
            Submit Vote (AA UserOp) — TODO
          </button>

          <button className='btn btnGhost' onClick={() => nav(`/dao/${pid}`)}>
            Back
          </button>
        </div>
      </div>
    </Layout>
  )
}
