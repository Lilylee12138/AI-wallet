import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'

const DAO_ABI = [
  'function getProposal(uint256) view returns (tuple(address proposer,uint64 startTime,uint64 endTime,string description,address target,uint256 value,bytes data,bytes32 metaHash,string metaURI,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,bool executed,bool finalized))',
  'function state(uint256) view returns (uint8)'
]

function stateLabel(s: number) {
  if (s === 1) return 'Active'
  if (s === 3) return 'Passed'
  if (s === 2) return 'Rejected'
  if (s === 4) return 'Executed'
  return 'Pending'
}

export default function DaoProposal() {
  const nav = useNavigate()
  const { id } = useParams()
  const pid = Number(id || 0)

  const [err, setErr] = useState('')
  const [p, setP] = useState<any>(null)
  const [st, setSt] = useState(0)

  useEffect(() => {
    ;(async () => {
      try {
        const provider = getInjectedProvider()
        await requestAccounts(provider)
        const chainId = await getChainId(provider)
        const dep = await loadDeployments(chainId)

        const dao = new ethers.Contract(dep.diamondAccount, DAO_ABI, provider)
        const proposal = await dao.getProposal(pid)
        const state = await dao.state(pid)

        setP(proposal)
        setSt(Number(state))
      } catch (e: any) {
        setErr(e?.message || String(e))
      }
    })()
  }, [pid])

  const totals = useMemo(() => {
    if (!p) return { forV: 0, againstV: 0, abstainV: 0, sum: 0 }
    const forV = Number(p.forVotes || 0)
    const againstV = Number(p.againstVotes || 0)
    const abstainV = Number(p.abstainVotes || 0)
    return { forV, againstV, abstainV, sum: forV + againstV + abstainV }
  }, [p])

  const pct = (v: number) => (totals.sum ? Math.round((v / totals.sum) * 1000) / 10 : 0)

  return (
    <Layout
      title='DAO Proposal'
      right={<button className='btn btnGhost' onClick={() => nav('/dao')}>←</button>}
    >
      {err && (
        <div className='card' style={{ padding: 14, borderColor: 'rgba(255,77,90,.35)' }}>
          <div className='small'>Error</div>
          <div style={{ marginTop: 8 }}>{err}</div>
        </div>
      )}

      {!p ? (
        <div className='card' style={{ padding: 16 }}>
          <div className='small'>Loading...</div>
        </div>
      ) : (
        <>
          <div className='card' style={{ padding: 16 }}>
            <div className='row' style={{ justifyContent: 'space-between', gap: 12 }}>
              <div className='h2' style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {String(p.description)}
              </div>
              <div className='small'>{stateLabel(st)}</div>
            </div>

            <div className='small' style={{ marginTop: 10 }}>
              start: {String(p.startTime)} • end: {String(p.endTime)} • executed: {String(p.executed)} • finalized: {String(p.finalized)}
            </div>

            <div className='cardSoft' style={{ marginTop: 14, padding: 14 }}>
              <div className='small'>AI Summary（预留）</div>
              <div className='small'>后续接入 Chatbot：总结提案、解释影响、辅助投票。</div>
            </div>

            <button
              className='btn btnPrimary'
              style={{ marginTop: 14, width: '100%' }}
              onClick={() => nav(`/action/vote/${pid}`)}
            >
              Vote Now (AA UserOp)
            </button>
          </div>

          <div className='card' style={{ marginTop: 14, padding: 16 }}>
            <div className='h2'>Current Results</div>

            <div style={{ marginTop: 12 }}>
              <div className='row' style={{ justifyContent: 'space-between' }}>
                <div className='small'>Yes / For</div>
                <div className='small'>{pct(totals.forV)}%</div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct(totals.forV)}%`, background: 'var(--green)' }} />
              </div>

              <div className='row' style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <div className='small'>No / Against</div>
                <div className='small'>{pct(totals.againstV)}%</div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct(totals.againstV)}%`, background: 'rgba(255,255,255,.35)' }} />
              </div>

              <div className='row' style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <div className='small'>Abstain</div>
                <div className='small'>{pct(totals.abstainV)}%</div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct(totals.abstainV)}%`, background: 'var(--blue)' }} />
              </div>

              <div className='small' style={{ marginTop: 12 }}>
                totals: for {totals.forV} • against {totals.againstV} • abstain {totals.abstainV}
              </div>
            </div>
          </div>
        </>
      )}
    </Layout>
  )
}
