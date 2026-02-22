import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import GasTankCard from '../components/GasTankCard'
import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

export default function Dashboard() {
  const [addr, setAddr] = useState('')
  const [diamond, setDiamond] = useState('')
  const [bal, setBal] = useState('0')
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const p = getInjectedProvider()
        await requestAccounts(p)
        const signer = p.getSigner()
        const a = await signer.getAddress()
        const chainId = await getChainId(p)
        const dep = await loadDeployments(chainId)

        setAddr(a)
        setDiamond(dep.diamondAccount)

        const b = await p.getBalance(dep.diamondAccount)
        setBal(ethers.utils.formatEther(b))
      } catch (e: any) {
        setErr(e?.message || String(e))
      }
    })()
  }, [])

  return (
    <Layout title='Main Wallet'>
      {err && (
        <div className='card' style={{ padding: 14, borderColor: 'rgba(255,77,90,.35)' }}>
          <div className='small'>Error</div>
          <div style={{ marginTop: 8 }}>{err}</div>
        </div>
      )}

      <div className='row g12'>
        <div className='card' style={{ padding: 16, flex: 1 }}>
          <div className='small'>Smart Account</div>
          <div style={{ marginTop: 8, fontWeight: 900 }}>{diamond.slice(0, 10)}…</div>
          <div className='small' style={{ marginTop: 8 }}>Balance</div>
          <div className='h1' style={{ marginTop: 4 }}>{bal} ETH</div>
        </div>

        <div style={{ marginTop: 14 }}>
          {diamond && <GasTankCard diamondAccount={diamond} />}
        </div>

        <div className='card' style={{ padding: 16, width: 150 }}>
          <div className='small'>Risk Guard</div>
          <div className='h2' style={{ marginTop: 10, color: 'var(--green)' }}>Secure</div>
          <div className='small' style={{ marginTop: 8 }}>
            预留：后续接入风险评分/解释
          </div>
        </div>
      </div>

      <div className='card' style={{ marginTop: 14, padding: 16 }}>
        <div className='h2'>Profile</div>
        <div className='small' style={{ marginTop: 8 }}>Connected EOA: {addr}</div>
        <div className='small'>Login Mode: EOA (dev)</div>
      </div>
    </Layout>
  )
}
