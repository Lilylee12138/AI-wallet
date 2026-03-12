import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'

declare global {
  interface Window {
    ethereum?: any
  }
}

type Props = {
  diamondAccount: string
}

const EP_DEPOSIT_ABI = [
  'function getEntryPointDeposit() view returns (uint256)',
  'function depositToEntryPoint() payable'
]

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

function fmtEth(bn?: ethers.BigNumber) {
  if (!bn) return '0.0'
  return Number(ethers.utils.formatEther(bn)).toFixed(4)
}

export default function GasTankCard({ diamondAccount }: Props) {
  const [connectedEOA, setConnectedEOA] = useState<string>('')
  const [chainIdHex, setChainIdHex] = useState<string>('')
  const [saBal, setSaBal] = useState<ethers.BigNumber>()
  const [deposit, setDeposit] = useState<ethers.BigNumber>()
  const [amount, setAmount] = useState<string>('0.05')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')

  const provider = useMemo(() => {
    if (!window.ethereum) return null
    return new ethers.providers.Web3Provider(window.ethereum)
  }, [])

  const contract = useMemo(() => {
    if (!provider || !diamondAccount) return null
    // 读用 provider，写的时候再 connect(signer)
    return new ethers.Contract(diamondAccount, EP_DEPOSIT_ABI, provider)
  }, [provider, diamondAccount])

  async function refresh() {
    if (!provider || !contract) return
    setErr('')
    try {
      const [net, accounts] = await Promise.all([
        provider.getNetwork(),
        provider.listAccounts()
      ])

      setChainIdHex(ethers.utils.hexValue(net.chainId))
      setConnectedEOA(accounts?.[0] || '')

      const [bal, dep] = await Promise.all([
        provider.getBalance(diamondAccount),
        contract.getEntryPointDeposit()
      ])

      setSaBal(bal)
      setDeposit(dep)
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  async function connectIfNeeded() {
    if (!provider) throw new Error('MetaMask not found')
    const accounts = await provider.send('eth_requestAccounts', [])
    setConnectedEOA(accounts?.[0] || '')
  }

  async function onDeposit() {
    setErr('')
    if (!provider || !contract) {
      setErr('MetaMask not found / contract not ready')
      return
    }

    try {
      setLoading(true)
      await connectIfNeeded()

      // 基本校验
      const v = amount.trim()
      if (!v || Number(v) <= 0) throw new Error('Amount must be > 0')

      const value = ethers.utils.parseEther(v)

      // 用 signer 发交易
      const signer = provider.getSigner()
      const writable = contract.connect(signer)

      const tx = await writable.depositToEntryPoint({ value })
      await tx.wait()

      await refresh()
    } catch (e: any) {
      // 用户拒绝签名
      if (e?.code === 4001) setErr('User rejected the request')
      else setErr(e?.reason || e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()

    if (!window.ethereum) return
    const onAccountsChanged = () => refresh()
    const onChainChanged = () => refresh()

    window.ethereum.on?.('accountsChanged', onAccountsChanged)
    window.ethereum.on?.('chainChanged', onChainChanged)

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccountsChanged)
      window.ethereum?.removeListener?.('chainChanged', onChainChanged)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diamondAccount, provider])

  return (
    <div className='card'>
      <div className='cardHeaderRow'>
        <div>
          <div className='cardTitle'>Gas Tank</div>
          <div className='cardSub'>
            SmartAccount: <span className='mono'>{shortAddr(diamondAccount)}</span>
          </div>
          <div className='cardSub'>
            Connected EOA: <span className='mono'>{connectedEOA ? shortAddr(connectedEOA) : '—'}</span>
          </div>
          <div className='cardSub'>
            Chain: <span className='mono'>{chainIdHex || '—'}</span>
          </div>
        </div>

        <button className='btnGhost' onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className='grid2'>
        <div className='statBox'>
          <div className='statLabel'>Smart Account ETH</div>
          <div className='statValue'>{fmtEth(saBal)} ETH</div>
        </div>

        <div className='statBox'>
          <div className='statLabel'>EntryPoint Deposit</div>
          <div className='statValue'>{fmtEth(deposit)} ETH</div>
        </div>
      </div>

      <div className='rowGap'>
        <div className='row'>
          <input
            className='input'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='0.05'
            inputMode='decimal'
          />
          <button className='btnSmall' onClick={() => setAmount('0.01')} disabled={loading}>0.01</button>
          <button className='btnSmall' onClick={() => setAmount('0.05')} disabled={loading}>0.05</button>
          <button className='btnSmall' onClick={() => setAmount('0.1')} disabled={loading}>0.1</button>
        </div>

        <button className='btnPrimary' onClick={onDeposit} disabled={loading}>
          {loading ? 'Depositing…' : 'Deposit to EntryPoint'}
        </button>

        {err ? <div className='errorBox'>Error: {err}</div> : null}
        <div className='hint'>
          Note: The ETH you send will be deposited into the <b>EntryPoint.deposit</b>（Gas Tank） to cover future AA <b>msg.value</b> gas costs. This is not a normal transfer to the contract address.
        </div>
      </div>
    </div>
  )
}
