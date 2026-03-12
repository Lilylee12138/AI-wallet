import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import Layout from '../components/Layout'
import { clearAuth, getAuth } from '../lib/auth'
import { useNavigate } from 'react-router-dom'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

const CONFIG_ABI = [
  'function getConfig() view returns (uint16,uint8,bool,bool,bool)'
]

export default function Settings() {
  const nav = useNavigate()
  const auth = getAuth()

  const [riskThreshold, setRiskThreshold] = useState<number | null>(null)
  const [validationMode, setValidationMode] = useState<number | null>(null)
  const [aiExplainEnabled, setAiExplainEnabled] = useState<boolean | null>(null)
  const [swapAdviceEnabled, setSwapAdviceEnabled] = useState<boolean | null>(null)
  const [configLoaded, setConfigLoaded] = useState(false)

  function logout() {
    clearAuth()
    nav('/auth', { replace: true })
  }

  useEffect(() => {
    ;(async () => {
      try {
        const p = getInjectedProvider()
        await requestAccounts(p)

        const chainId = await getChainId(p)
        const dep = await loadDeployments(chainId)

        const diamond = new ethers.Contract(
          dep.diamondAccount,
          CONFIG_ABI,
          p
        )

        const cfg = await diamond.getConfig()

        setRiskThreshold(Number(cfg[0]))
        setValidationMode(Number(cfg[1]))
        setAiExplainEnabled(Boolean(cfg[2]))
        setSwapAdviceEnabled(Boolean(cfg[3]))
        setConfigLoaded(true)
      } catch (e) {
        console.error('Failed to load config', e)
        setConfigLoaded(true)
      }
    })()
  }, [])

  function modeText() {
    if (validationMode === null) return '-'
    return validationMode === 0 ? 'permissive' : 'strict'
  }

  function boolText(v: boolean | null) {
    if (v === null) return '-'
    return v ? 'enabled' : 'disabled'
  }

  return (
    <Layout title='Settings'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Configuration</div>

        <div className='small' style={{ marginTop: 8 }}>
          Wallet policy parameters stored on-chain via ConfigFacet.
        </div>

        <div className='small' style={{ marginTop: 14, lineHeight: 1.7 }}>
          <div>Risk threshold: {riskThreshold ?? '-'}</div>
          <div>Validation mode: {modeText()}</div>
          <div>AI explain: {boolText(aiExplainEnabled)}</div>
          <div>Swap advisory: {boolText(swapAdviceEnabled)}</div>
        </div>

        <hr className='sep' />

        <div className='h2'>Session</div>

        <div className='small' style={{ marginTop: 8 }}>
          mode: {auth?.mode || '-'} • created:{' '}
          {auth?.ts ? new Date(auth.ts).toLocaleString() : '-'}
        </div>

        <button
          className='btn btnDanger'
          style={{ marginTop: 14, width: '100%' }}
          onClick={logout}
        >
          Log out
        </button>
      </div>
    </Layout>
  )
}