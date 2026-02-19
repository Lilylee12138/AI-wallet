import Layout from '../components/Layout'
import { useNavigate } from 'react-router-dom'

export default function Auth() {
  const nav = useNavigate()

  return (
    <Layout title='AI Wallet'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Welcome back</div>
        <div className='small' style={{ marginTop: 8 }}>
          这里是登录入口（预留 Passkey / OAuth）。当前先用 EOA/MetaMask 作为开发阶段身份。
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <button className='btn btnGhost' onClick={() => nav('/dashboard')}>
            Connect EOA Wallet (MetaMask)
          </button>
          <button className='btn btnGhost' disabled>
            Login with Passkey (WebAuthn) — TODO
          </button>
          <button className='btn btnGhost' disabled>
            Social Login (OAuth) — TODO
          </button>
        </div>
      </div>
    </Layout>
  )
}
