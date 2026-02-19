import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

type Row = { id: number; description: string; state: number }

const DAO_VIEW_ABI = [
  'function getProposal(uint256) view returns (tuple(address proposer,uint64 startTime,uint64 endTime,string description,address target,uint256 value,bytes data,bytes32 metaHash,string metaURI,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,bool executed,bool finalized))',
  'function state(uint256) view returns (uint8)'
]

const DAO_EVENT_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, bytes32 indexed proposerMemberId, string description)'
]

function stateLabel(s: number) {
  if (s === 1) return 'Active'
  if (s === 3) return 'Passed'
  if (s === 2) return 'Rejected'
  if (s === 4) return 'Executed'
  return 'Pending'
}

export default function Dao() {
  const nav = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const provider = getInjectedProvider()
        await requestAccounts(provider)
        const chainId = await getChainId(provider)
        const dep = await loadDeployments(chainId)

        const diamondAddr = dep.diamondAccount

        // event query from diamond address
        const iface = new ethers.utils.Interface(DAO_EVENT_ABI)
        const topic0 = iface.getEventTopic('ProposalCreated')

        const logs = await provider.getLogs({
          address: diamondAddr,
          fromBlock: 0,
          toBlock: 'latest',
          topics: [topic0]
        })

        const ids: number[] = []
        for (const lg of logs) {
          const parsed = iface.parseLog(lg)
          ids.push((parsed.args.proposalId as ethers.BigNumber).toNumber())
        }

        const uniq = Array.from(new Set(ids)).sort((a, b) => a - b)

        const dao = new ethers.Contract(diamondAddr, DAO_VIEW_ABI, provider)
        const list: Row[] = []
        for (const id of uniq) {
          const p = await dao.getProposal(id)
          const st = await dao.state(id)
          list.push({ id, description: String(p.description), state: Number(st) })
        }

        setRows(list.reverse())
      } catch (e: any) {
        setErr(e?.message || String(e))
      }
    })()
  }, [])

  return (
    <Layout title='DAO Governance'>
      {err && (
        <div className='card' style={{ padding: 14, borderColor: 'rgba(255,77,90,.35)' }}>
          <div className='small'>Error</div>
          <div style={{ marginTop: 8 }}>{err}</div>
          <div className='small' style={{ marginTop: 8 }}>
            提示：请确认 MetaMask 连接 localhost:8545 (chainId=31337)，并已运行 deploy seed proposals
          </div>
        </div>
      )}

      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Active</div>
        <div className='small' style={{ marginTop: 6 }}>
          Snapshot-style UI • On-chain proposals (event-driven)
        </div>

        <div className='col g12' style={{ marginTop: 14 }}>
          {rows.map((r) => (
            <button
              key={r.id}
              className='btn btnGhost'
              style={{ textAlign: 'left' }}
              onClick={() => nav(`/dao/${r.id}`)}
            >
              <div className='row' style={{ justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {`#${r.id}  ${r.description}`}
                </div>
                <div className='small'>{stateLabel(r.state)}</div>
              </div>
            </button>
          ))}

          {rows.length === 0 && !err && (
            <div className='cardSoft' style={{ padding: 14 }}>
              <div className='small'>No proposals found</div>
              <div className='small' style={{ marginTop: 6 }}>
                未检测到 ProposalCreated 事件。请确认 deploy 脚本已 seed。
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
