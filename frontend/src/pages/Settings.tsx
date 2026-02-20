import Layout from '../components/Layout'
import { clearAuth, getAuth } from '../lib/auth'
import { useNavigate } from 'react-router-dom'

export default function Settings() {
  const nav = useNavigate()
  const auth = getAuth()

  function logout() {
    clearAuth()
    nav('/auth', { replace: true })
  }

  return (
    <Layout title='Settings'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Configuration</div>
        <div className='small' style={{ marginTop: 8 }}>
          预留：后续接 ConfigFacet（模式开关、阈值、风险策略等）
        </div>

        <hr className='sep' />

        <div className='h2'>Session</div>
        <div className='small' style={{ marginTop: 8 }}>
          mode: {auth?.mode || '-'} • created: {auth?.ts ? new Date(auth.ts).toLocaleString() : '-'}
        </div>

        <button className='btn btnDanger' style={{ marginTop: 14, width: '100%' }} onClick={logout}>
          Log out
        </button>
      </div>
    </Layout>
  )
}
