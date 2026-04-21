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
      setAuthed('eoa', { chainId })
      nav(redirectTo, { replace: true })
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function loginPasskey() {
    setAuthed('passkey', { note: 'TODO: integrate WebAuthn session' })
    nav(redirectTo, { replace: true })
  }

  async function loginOAuth(provider: 'google' | 'apple') {
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

  function badge(text: string) {
    return (
      <div
        style={{
          padding: '4px 10px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,.08)',
          background: 'rgba(255,255,255,.05)',
          fontSize: 12,
          fontWeight: 700,
          color: 'rgba(255,255,255,.72)',
          whiteSpace: 'nowrap'
        }}
      >
        {text}
      </div>
    )
  }

  return (
    <Layout title='AI Wallet' hideNav>
      <div
        className='card'
        style={{
          padding: 18,
          maxWidth: 560,
          margin: '0 auto'
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(90,255,210,.08)',
            border: '1px solid rgba(90,255,210,.18)',
            color: 'rgba(220,255,245,.92)',
            fontSize: 12,
            fontWeight: 800
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: 'var(--green)',
              boxShadow: '0 0 10px rgba(90,255,210,.75)'
            }}
          />
          AI Smart Contract Wallet
        </div>

        <div className='h2' style={{ marginTop: 14 }}>
          Welcome back
        </div>

        <div
          className='small'
          style={{
            marginTop: 8,
            lineHeight: 1.7,
            opacity: 0.78
          }}
        >
          Choose how you want to continue. MetaMask is currently available and is used as a signer to authorize your smart account.
        </div>

        {err && (
          <div
            className='cardSoft'
            style={{
              marginTop: 16,
              padding: 12,
              border: '1px solid rgba(255,77,90,.22)',
              background: 'rgba(255,77,90,.08)'
            }}
          >
            <div
              className='small'
              style={{
                color: 'rgba(255,210,210,.95)',
                fontWeight: 800
              }}
            >
              Error
            </div>
            <div
              className='small'
              style={{
                marginTop: 6,
                lineHeight: 1.6,
                opacity: 0.92
              }}
            >
              {err}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button
            className='btn btnPrimary'
            onClick={loginEOA}
            disabled={busy}
            style={{
              width: '100%',
              minHeight: 54,
              fontSize: 16,
              fontWeight: 800
            }}
          >
            {busy ? 'Connecting...' : 'Continue with MetaMask'}
          </button>

          <div
            className='small'
            style={{
              marginTop: 10,
              opacity: 0.72,
              lineHeight: 1.6
            }}
          >
            
          </div>
        </div>

        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,.08)'
          }}
        >
          <div
            className='small'
            style={{
              fontWeight: 800,
              opacity: 0.82,
              marginBottom: 12
            }}
          >
            Other ways to sign in
          </div>

          <div className='col g12'>
            <button
              className='btn btnGhost'
              onClick={loginPasskey}
              disabled={busy}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: 50,
                paddingInline: 14
              }}
            >
              <span>Continue with Passkey</span>
              {badge('Coming soon')}
            </button>

            <button
              className='btn btnGhost'
              onClick={() => loginOAuth('google')}
              disabled={busy}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: 50,
                paddingInline: 14
              }}
            >
              <span>Continue with Google</span>
              {badge('Coming soon')}
            </button>

            <button
              className='btn btnGhost'
              onClick={() => loginOAuth('apple')}
              disabled={busy}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: 50,
                paddingInline: 14
              }}
            >
              <span>Continue with Apple</span>
              {badge('Coming soon')}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}