import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'

import { getInjectedProvider, requestAccounts, getChainId } from '../../lib/eth'
import { loadDeployments } from '../../config/deployments'
import { buildUserOp, signUserOpEOA, sendUserOp } from '../../lib/aa'

const EXEC_ABI = ['function execute(address target,uint256 value,bytes data) returns (bytes)']

// Mock router interface (你会在下一步部署它)
const MOCK_ROUTER_ABI = [
  'function swapEthToMockUsdt(address to) payable returns (uint256 outAmount)'
]

export default function ActionSwap() {
  const nav = useNavigate()

  const [dep, setDep] = useState<any>(null)

  const [amountEth, setAmountEth] = useState('0.001')
  const [routerAddr, setRouterAddr] = useState('')

  const [sending, setSending] = useState(false)
  const [txMsg, setTxMsg] = useState('')
  const [txErr, setTxErr] = useState('')

  async function loadDep() {
    const p = getInjectedProvider()
    await requestAccounts(p)
    const chainId = await getChainId(p)
    const d = await loadDeployments(chainId)
    setDep(d)
    // 兼容：如果你 deployments 里有 mockSwapRouter 字段，就自动填充
    if (!routerAddr && (d as any).mockSwapRouter) setRouterAddr((d as any).mockSwapRouter)
    return { p, d }
  }

  useEffect(() => {
    ;(async () => {
      try {
        await loadDep()
      } catch (e: any) {
        setTxErr(e?.message || String(e))
      }
    })()
  }, [])

  async function swap() {
    setTxMsg('')
    setTxErr('')
    setSending(true)
    try {
      const { p, d } = await loadDep()

      if (!routerAddr) {
        throw new Error('No router address. Please deploy MockSwapRouter and set deployments.mockSwapRouter')
      }

      const router = ethers.utils.getAddress(routerAddr.trim())
      const value = ethers.utils.parseEther((amountEth || '0').trim())
      if (value.lte(0)) throw new Error('Amount must be > 0')

      const accounts = await p.listAccounts()
      if (!accounts.length) throw new Error('MetaMask not connected')
      const beneficiary = accounts[0]

      // inner data: call router.swapEthToMockUsdt(to=diamondAccount)
      // 这里 to 用 diamondAccount 地址，表示“换到钱包里”
      const routerIface = new ethers.utils.Interface(MOCK_ROUTER_ABI)
      const innerData = routerIface.encodeFunctionData('swapEthToMockUsdt', [d.diamondAccount])

      // outer calldata: execute(router, value, innerData)
      const execIface = new ethers.utils.Interface(EXEC_ABI)
      const callData = execIface.encodeFunctionData('execute', [router, value, innerData])

      const { userOp, userOpHash } = await buildUserOp({
        provider: p,
        entryPoint: d.entryPoint,
        diamond: d.diamondAccount,
        callData,
      })

      userOp.signature = await signUserOpEOA({ provider: p, userOpHash })

      const receipt = await sendUserOp({
        provider: p,
        entryPoint: d.entryPoint,
        beneficiary,
        userOp,
      })

      setTxMsg(`Swap sent. tx=${receipt.transactionHash}`)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e)
      setTxErr(msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout title='Swap'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Swap (AA)</div>
        <div className='small' style={{ marginTop: 8 }}>
          MVP：使用 AA 调用 ExecutionFacet.execute(router, value, data) 触发 MockSwapRouter 的 swap 事件。
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <div className='small'>Router (MockSwapRouter address)</div>
          <input
            className='input'
            placeholder='0x...'
            value={routerAddr}
            onChange={(e) => setRouterAddr(e.target.value)}
          />

          <div className='small'>Amount (ETH)</div>
          <input
            className='input'
            placeholder='0.001'
            value={amountEth}
            onChange={(e) => setAmountEth(e.target.value)}
          />

          <button className='btn btnPrimary' disabled={sending || !dep} onClick={swap}>
            {sending ? 'Swapping…' : 'Swap (AA UserOp)'}
          </button>

          {txMsg && <div style={{ marginTop: 10, color: 'var(--green)' }}>{txMsg}</div>}
          {txErr && <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>{txErr}</div>}

          {!((dep as any)?.mockSwapRouter) && (
            <div className='small' style={{ marginTop: 12, opacity: 0.8 }}>
              提示：你还没部署 MockSwapRouter（deployments 里没有 mockSwapRouter）。我下面给你一条命令，部署后会自动写入 deployments/31337.json 和 frontend/public/deployments/31337.json。
            </div>
          )}

          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>
      </div>
    </Layout>
  )
}
