import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'

import { getInjectedProvider, requestAccounts, getChainId } from '../../lib/eth'
import { loadDeployments } from '../../config/deployments'
import { buildUserOp, signUserOpEOA, sendUserOp } from '../../lib/aa'

const EXEC_ABI = ['function execute(address target,uint256 value,bytes data) returns (bytes)']

export default function ActionTransfer() {
  const nav = useNavigate()

  const [dep, setDep] = useState<any>(null)
  const [to, setTo] = useState('')
  const [amt, setAmt] = useState('0.001')

  const [sending, setSending] = useState(false)
  const [txMsg, setTxMsg] = useState('')
  const [txErr, setTxErr] = useState('')

  async function loadDep() {
    const p = getInjectedProvider()
    await requestAccounts(p)
    const chainId = await getChainId(p)
    const d = await loadDeployments(chainId)
    setDep(d)
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

  async function send() {
    setTxMsg('')
    setTxErr('')
    setSending(true)
    try {
      const { p, d } = await loadDep()

      if (!to) throw new Error('Recipient is required')
      const recipient = ethers.utils.getAddress(to.trim())

      const value = ethers.utils.parseEther((amt || '0').trim())
      if (value.lte(0)) throw new Error('Amount must be > 0')

      const accounts = await p.listAccounts()
      if (!accounts.length) throw new Error('MetaMask not connected')
      const beneficiary = accounts[0]

      //debug logs
      console.log('[debug] amt input =', amt)
      console.log('[debug] value(wei) =', value.toString())
      console.log('[debug] value(eth) =', ethers.utils.formatEther(value))


      // calldata = DiamondAccount(delegatecall) -> ExecutionFacet.execute(recipient, value, 0x)
      const execIface = new ethers.utils.Interface(EXEC_ABI)
      const callData = execIface.encodeFunctionData('execute', [recipient, value, '0x'])

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
      console.log('[debug] receipt =', receipt)//debug
      
      setTxMsg(`Sent successfully. tx=${receipt.transactionHash}`)
    } catch (e: any) {
      // 尽量把错误变成人话
      const msg = e?.shortMessage || e?.reason || e?.message || String(e)
      setTxErr(msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout title='Send'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Transfer (AA)</div>
        <div className='small' style={{ marginTop: 8 }}>
          通过 ERC-4337 UserOp 调用 DiamondAccount → ExecutionFacet.execute(to,value,data) 完成转账。
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          <input
            className='input'
            placeholder='Recipient address (0x...)'
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <input
            className='input'
            placeholder='Amount (ETH)'
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />

          <button className='btn btnPrimary' disabled={sending || !dep} onClick={send}>
            {sending ? 'Sending…' : 'Send (AA UserOp)'}
          </button>

          {txMsg && <div style={{ marginTop: 10, color: 'var(--green)' }}>{txMsg}</div>}
          {txErr && <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>{txErr}</div>}

          <button className='btn btnGhost' onClick={() => nav('/trade')}>
            Back
          </button>
        </div>

        <div className='small' style={{ marginTop: 12, opacity: 0.75 }}>
          提示：Smart Account 需要有 ETH；同时 EntryPoint deposit 需要足够用于 handleOps gas（你已有 Gas Tank 页面可充值）。
        </div>
      </div>
    </Layout>
  )
}
