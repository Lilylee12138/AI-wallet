import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'

declare global {
  interface Window {
    ethereum?: any
  }
}

type GasTankStatus = 'empty' | 'low' | 'ready'

type Props = {
  diamondAccount: string
  onStatusChange?: (info: {
    depositEth: string
    status: GasTankStatus
    smartAccountEth: string
  }) => void
}

const EP_DEPOSIT_ABI = [
  'function getEntryPointDeposit() view returns (uint256)',
  'function depositToEntryPoint() payable'
]

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

function fmtEth(bn?: ethers.BigNumber) {
  if (!bn) return '0.0000'
  return Number(ethers.utils.formatEther(bn)).toFixed(4)
}

function getGasTankStatus(dep?: ethers.BigNumber): GasTankStatus {
  if (!dep) return 'empty'
  const n = Number(ethers.utils.formatEther(dep))
  if (n <= 0) return 'empty'
  if (n < 0.01) return 'low'
  return 'ready'
}

function statusText(status: GasTankStatus) {
  if (status === 'empty') return 'Gas Tank Empty'
  if (status === 'low') return 'Gas Tank Low'
  return 'Gas Tank Ready'
}

function statusHint(status: GasTankStatus) {
  if (status === 'empty') return 'Please deposit ETH before sending AA transactions'
  if (status === 'low') return 'Deposit more ETH soon to avoid failed AA transactions'
  return 'EntryPoint deposit available for future AA gas costs'
}

function statusColor(status: GasTankStatus) {
  if (status === 'empty') return 'rgba(255,77,90,.95)'
  if (status === 'low') return 'rgba(255,196,77,.95)'
  return 'var(--green)'
}

function statusBg(status: GasTankStatus) {
  if (status === 'empty') return 'rgba(255,77,90,.08)'
  if (status === 'low') return 'rgba(255,196,77,.08)'
  return 'rgba(90,255,210,.08)'
}

export default function GasTankCard({ diamondAccount, onStatusChange }: Props) {
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
    return new ethers.Contract(diamondAccount, EP_DEPOSIT_ABI, provider)
  }, [provider, diamondAccount])

  const gasStatus = getGasTankStatus(deposit)
  const gasColor = statusColor(gasStatus)

  async function refresh() {
    if (!provider || !contract) return
    setErr('')

    try {
      const net = await provider.getNetwork()
      setChainIdHex(ethers.utils.hexValue(net.chainId))

      const [bal, dep] = await Promise.all([
        provider.getBalance(diamondAccount),
        contract.getEntryPointDeposit()
      ])

      setSaBal(bal)
      setDeposit(dep)

      onStatusChange?.({
        depositEth: fmtEth(dep),
        status: getGasTankStatus(dep),
        smartAccountEth: fmtEth(bal),
      })
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  async function connectIfNeeded() {
    if (!provider) throw new Error('MetaMask not found')
    await provider.send('eth_requestAccounts', [])
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

      const v = amount.trim()
      if (!v || Number(v) <= 0) throw new Error('Amount must be > 0')

      const value = ethers.utils.parseEther(v)
      const signer = provider.getSigner()
      const writable = contract.connect(signer)

      const tx = await writable.depositToEntryPoint({ value })
      await tx.wait()

      await refresh()
    } catch (e: any) {
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
    <div
      className='card'
      style={{
        padding: 16,
        borderColor: `${gasColor}22`,
      }}
    >
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          border: `1px solid ${gasColor}22`,
          background: `linear-gradient(135deg, ${statusBg(gasStatus)}, rgba(60,160,255,0.10))`,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                color: gasColor,
                fontSize: 18,
                fontWeight: 900,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: gasColor,
                  boxShadow: `0 0 12px ${gasColor}`,
                  display: 'inline-block',
                }}
              />
              {statusText(gasStatus)}
            </div>

            <div className='small' style={{ marginTop: 6, opacity: 0.76, lineHeight: 1.45 }}>
              {statusHint(gasStatus)}
            </div>
          </div>

          <button
            className='btn btnGhost'
            onClick={refresh}
            disabled={loading}
            style={{ minWidth: 0 }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div className='cardSoft' style={{ padding: 12 }}>
          <div className='small'>EntryPoint Deposit</div>
          <div style={{ marginTop: 6, fontWeight: 900, fontSize: 20 }}>
            {fmtEth(deposit)} ETH
          </div>
        </div>

        <div className='cardSoft' style={{ padding: 12 }}>
          <div className='small'>Smart Account ETH</div>
          <div style={{ marginTop: 6, fontWeight: 900, fontSize: 20 }}>
            {fmtEth(saBal)} ETH
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div className='cardSoft' style={{ padding: 10 }}>
          <div className='small'>Smart Account</div>
          <div
            style={{
              marginTop: 4,
              fontWeight: 800,
              fontFamily: 'monospace',
            }}
          >
            {shortAddr(diamondAccount)}
          </div>
        </div>

        <div className='cardSoft' style={{ padding: 10 }}>
          <div className='small'>Chain</div>
          <div
            style={{
              marginTop: 4,
              fontWeight: 800,
              fontFamily: 'monospace',
            }}
          >
            {chainIdHex || '-'}
          </div>
        </div>
      </div>

      <div className='small' style={{ marginBottom: 8, opacity: 0.86 }}>
        Top up Gas Tank
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto auto',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          className='input'
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder='0.05'
          inputMode='decimal'
        />

        <button
          className='btn btnGhost'
          onClick={() => setAmount('0.01')}
          disabled={loading}
          style={{ minWidth: 0, padding: '0 14px' }}
        >
          0.01
        </button>

        <button
          className='btn btnGhost'
          onClick={() => setAmount('0.05')}
          disabled={loading}
          style={{ minWidth: 0, padding: '0 14px' }}
        >
          0.05
        </button>

        <button
          className='btn btnGhost'
          onClick={() => setAmount('0.1')}
          disabled={loading}
          style={{ minWidth: 0, padding: '0 14px' }}
        >
          0.1
        </button>
      </div>

      <button
        className='btn btnPrimary'
        onClick={onDeposit}
        disabled={loading}
      >
        {loading ? 'Depositing…' : 'Deposit to EntryPoint'}
      </button>

      {err ? (
        <div className='errorBox' style={{ marginTop: 12 }}>
          Error: {err}
        </div>
      ) : null}

      <div className='small' style={{ marginTop: 12, opacity: 0.72, lineHeight: 1.45 }}>
        The ETH you send here goes to <b>EntryPoint.deposit</b> as your Gas Tank for future AA transaction costs.
      </div>
    </div>
  )
}