import Layout from '../components/Layout'
import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { setAuthed } from '../lib/auth'

export default function Auth() {
  const nav = useNavigate()
  const loc = useLocation() as any
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const redirectTo = loc?.state?.from || '/dashboard'

  async function loginEOA() {
    setErr('')
    setBusy(true)
    try {
      const p = getInjectedProvider()
      await requestAccounts(p)
      const chainId = await getChainId(p)
      // 真实可用：记录 mode + chainId，后续可加 address / sessionNonce 等
      setAuthed('eoa', { chainId })
      nav(redirectTo, { replace: true })
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function loginPasskey() {
    // 目前先做 UI/入口占位：后续会接 WebAuthn + IdentityFacet session
    setAuthed('passkey', { note: 'TODO: integrate WebAuthn session' })
    nav(redirectTo, { replace: true })
  }

  async function loginOAuth(provider: 'google' | 'apple') {
    // 目前先做 UI/入口占位：后续会接 OAuth issuer + session attest
    setAuthed('oauth', { provider, note: 'TODO: integrate OAuth issuer session' })
    nav(redirectTo, { replace: true })
  }

  const pageContext = useMemo(() => {
    return {
      path: window.location.pathname,
      page: 'auth',
      title: 'AI Wallet',
      context: {
        pageTitle: 'Welcome back',
        loginStage: 'development',
        activeMethod: 'EOA',
        availableMethods: ['EOA', 'Passkey', 'Google OAuth', 'Apple OAuth'],
        eoaEnabled: true,
        passkeyStatus: 'placeholder',
        googleOAuthStatus: 'placeholder',
        appleOAuthStatus: 'placeholder',
        identityLayer: 'IdentityFacet planned',
        redirectTo,
        busy,
        error: err || '',
        helperText:
          'EOA is currently available for real connection. Passkey and OAuth are placeholders and will be integrated with IdentityFacet later.'
      }
    }
  }, [redirectTo, busy, err])

  useEffect(() => {
    try {
      sessionStorage.setItem('wallet_ai_context', JSON.stringify(pageContext))
    } catch (e) {
      console.error(e)
    }
  }, [pageContext])

  return (
    <Layout title='AI Wallet'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Welcome back</div>
        <div className='small' style={{ marginTop: 8 }}>
          Please choose a login method. Currently, EOA login is available. Passkey and OAuth are placeholders and will be integrated with IdentityFacet later.
        </div>

        {err && (
          <div className='cardSoft' style={{ marginTop: 14, padding: 12, borderColor: 'rgba(255,77,90,.35)' }}>
            <div className='small'>Error</div>
            <div style={{ marginTop: 6 }}>{err}</div>
          </div>
        )}

        <div className='col g12' style={{ marginTop: 14 }}>
          <button className='btn btnPrimary' onClick={loginEOA} disabled={busy}>
            Connect EOA Wallet (MetaMask)
          </button>

          <button className='btn btnGhost' onClick={loginPasskey} disabled={busy}>
            Login with Passkey (WebAuthn) — placeholder
          </button>

          <div className='row g12'>
            <button className='btn btnGhost' style={{ flex: 1 }} onClick={() => loginOAuth('google')} disabled={busy}>
              Google OAuth — placeholder
            </button>
            <button className='btn btnGhost' style={{ flex: 1 }} onClick={() => loginOAuth('apple')} disabled={busy}>
              Apple OAuth — placeholder
            </button>
          </div>

          
        </div>
      </div>
    </Layout>
  )
}