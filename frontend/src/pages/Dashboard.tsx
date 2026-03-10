import { useCallback, useEffect, useState } from 'react'
import Layout from '../components/Layout'
import GasTankCard from '../components/GasTankCard'
import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

type TokenBalances = {
  ETH: string
  GOV: string
  USD: string
  WETH: string
}

function fmt(v: string) {
  const n = Number(v || '0')
  if (!Number.isFinite(n)) return '0.0000'
  return n.toFixed(4)
}

export default function Dashboard() {
  const [addr, setAddr] = useState('')
  const [diamond, setDiamond] = useState('')
  const [bal, setBal] = useState('0')
  const [tokens, setTokens] = useState<TokenBalances>({
    ETH: '0',
    GOV: '0',
    USD: '0',
    WETH: '0',
  })
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const refreshBalances = useCallback(async () => {
    try {
      setRefreshing(true)
      setErr('')

      const p = getInjectedProvider()
      await requestAccounts(p)

      const signer = p.getSigner()
      const a = await signer.getAddress()
      const chainId = await getChainId(p)
      const dep = await loadDeployments(chainId)

      setAddr(a)
      setDiamond(dep.diamondAccount)

      const ethBal = await p.getBalance(dep.diamondAccount)
      const eth = ethers.utils.formatEther(ethBal)
      setBal(eth)

      const next: TokenBalances = {
        ETH: eth,
        GOV: '0',
        USD: '0',
        WETH: '0',
      }

      const tokenMap = dep.tokens || {}

      for (const sym of ['GOV', 'USD', 'WETH'] as const) {
        const tokenAddr = tokenMap[sym]
        if (!tokenAddr) continue

        const token = new ethers.Contract(tokenAddr, ERC20_ABI, p)
        const [raw, decimals] = await Promise.all([
          token.balanceOf(dep.diamondAccount),
          token.decimals(),
        ])

        next[sym] = ethers.utils.formatUnits(raw, decimals)
      }

      setTokens(next)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refreshBalances()
  }, [refreshBalances])

  useEffect(() => {
    const onFocus = () => {
      refreshBalances()
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshBalances])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshBalances()
    }, 8000)

    return () => window.clearInterval(timer)
  }, [refreshBalances])

  return (
    <Layout title='Main Wallet'>
      {err && (
        <div
          className='card'
          style={{ padding: 12, marginBottom: 12, borderColor: 'rgba(255,77,90,.35)' }}
        >
          <div className='small'>Error</div>
          <div className='small' style={{ marginTop: 6 }}>{err}</div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '0.9fr 1.6fr',
          gap: 12,
        }}
      >
        <div className='card' style={{ padding: 14 }}>
          <div className='small'>Risk Guard</div>
          <div
            style={{
              marginTop: 8,
              fontWeight: 900,
              fontSize: 18,
              color: 'var(--green)',
            }}
          >
            Secure
          </div>
          <div className='small' style={{ marginTop: 8 }}>
            AI risk monitoring enabled
          </div>
        </div>

        <div className='card' style={{ padding: 14 }}>
          <div className='small'>Profile</div>

          <div className='small' style={{ marginTop: 8 }}>
            Smart Account: {diamond ? `${diamond.slice(0, 10)}...${diamond.slice(-4)}` : 'Loading...'}
          </div>

          <div className='small' style={{ marginTop: 6 }}>
            EOA: {addr || 'Loading...'}
          </div>

          <div className='small' style={{ marginTop: 6 }}>
            Login: EOA (dev)
          </div>
        </div>
      </div>

      <div className='card' style={{ marginTop: 12, padding: 14 }}>
        <div
          className='row'
          style={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div className='h2'>Assets</div>
          <button
            className='btn btnGhost'
            style={{ padding: '8px 14px', minWidth: 0 }}
            onClick={refreshBalances}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          <div className='cardSoft' style={{ padding: 10 }}>
            <div className='small'>ETH</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800 }}>
              {fmt(tokens.ETH)}
            </div>
          </div>

          <div className='cardSoft' style={{ padding: 10 }}>
            <div className='small'>GOV</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800 }}>
              {fmt(tokens.GOV)}
            </div>
          </div>

          <div className='cardSoft' style={{ padding: 10 }}>
            <div className='small'>USD</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800 }}>
              {fmt(tokens.USD)}
            </div>
          </div>

          <div className='cardSoft' style={{ padding: 10 }}>
            <div className='small'>WETH</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800 }}>
              {fmt(tokens.WETH)}
            </div>
          </div>
        </div>

        <div className='small' style={{ marginTop: 10 }}>
          Main balance: {fmt(bal)} ETH
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {diamond && <GasTankCard diamondAccount={diamond} />}
      </div>
    </Layout>
  )
}