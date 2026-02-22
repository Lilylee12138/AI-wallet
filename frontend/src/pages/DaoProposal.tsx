import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'
import { buildUserOp, signUserOpEOA, sendUserOp } from '../lib/aa'
import { getStableMemberId } from "../lib/member";

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../components/Layout'


const DAO_ABI = [
  'function getProposal(uint256) view returns (tuple(address proposer,uint64 startTime,uint64 endTime,string description,address target,uint256 value,bytes data,bytes32 metaHash,string metaURI,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,bool executed,bool finalized))',
  'function state(uint256) view returns (uint8)'
]

function stateLabel(s: number) {
  if (s === 1) return 'Active'
  if (s === 2) return 'Passed'
  if (s === 3) return 'Rejected'
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
  const [dep, setDep] = useState<any>(null)

  async function refreshProposal() {
    const provider = getInjectedProvider()
    await requestAccounts(provider)
    const chainId = await getChainId(provider)
    const d = await loadDeployments(chainId)
    setDep(d)

    const dao = new ethers.Contract(d.diamondAccount, DAO_ABI, provider)
    const proposal = await dao.getProposal(pid)
    const state = await dao.state(pid)

    setP(proposal)
    setSt(Number(state))

    console.log('[refreshProposal] pid=', pid, 'diamond=', d.diamondAccount)
    console.log(
      '[refreshProposal] forVotes=',
      proposal.forVotes?.toString?.() ?? String(proposal.forVotes),
      'against=',
      proposal.againstVotes?.toString?.() ?? String(proposal.againstVotes),
      'abstain=',
      proposal.abstainVotes?.toString?.() ?? String(proposal.abstainVotes)
    )
  }

  useEffect(() => {
    ;(async () => {
      try {
        await refreshProposal()
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

  const [txErr, setTxErr] = useState('')
  const [txMsg, setTxMsg] = useState('')
  const [sending, setSending] = useState(false)
  const canVote = st === 1

  async function vote(support: number) {
    if (!dep) {
      setErr('Deployment not loaded yet')
      return
    } //vote() 里增加防御
    setTxErr('')
    setTxMsg('')
    setSending(true)
    try {
      const p = getInjectedProvider()
      await requestAccounts(p)
      const chainId = await getChainId(p)
      const dep = await loadDeployments(chainId)

      console.log('vote debug:', { chainId, pid, dep })
      console.log('entryPoint=', dep?.entryPoint, 'diamond=', dep?.diamondAccount)

      //const beneficiary = await p.getSigner().getAddress()
      const accounts = await p.listAccounts()
      if (!accounts.length) throw new Error('MetaMask not connected')
      const beneficiary = accounts[0]

      console.log('beneficiary =', beneficiary)
      
      // 1) 先拿 memberId（必须用 signer，保证 msg.sender=你的MetaMask地址）
      //const signer = p.getSigner();

      //const identityView = new ethers.Contract(
      //  dep.diamondAccount,
      //  ['function currentMemberId() view returns (bytes32)'],
      //  signer
      //)
      //const mid = await identityView.currentMemberId()
      //console.log('[debug] currentMemberId(from signer)=', mid)
      
      const { eoa, memberId } = await getStableMemberId(p);
      const mid = memberId;
      console.log("[vote] eoa=", eoa, "mid(stable)=", mid);
      // 2️ 再构造 callData
      const daoIface = new ethers.utils.Interface([
        'function castVoteAs(uint256 proposalId, uint8 support, bytes32 voterMemberId)'
      ]);

      const daoRead = new ethers.Contract(
      dep.diamondAccount,
      ["function isMember(bytes32) view returns (bool)"],
      p
    );
    const ok = await daoRead.isMember(mid);
    if (!ok) {
      setTxMsg("You are not a DAO member (NotMember). mid=" + mid);
      setSending(false);
      return;
    }

    const callData = daoIface.encodeFunctionData(
        'castVoteAs',
        [Number(pid), support, mid]
      );
      
      const { userOp, userOpHash } = await buildUserOp({
        provider: p,
        entryPoint: dep.entryPoint,
        diamond: dep.diamondAccount,
        callData
      })

      try {
        userOp.signature = await signUserOpEOA({ provider: p, userOpHash })

        const { receipt, success, revertReason } = await sendUserOp({
          provider: p,
          entryPoint: dep.entryPoint,
          beneficiary,
          userOp,
          userOpHash, // 关键：传进去才能匹配日志
        })

        console.log('vote receipt', receipt)
        console.log('userOp success=', success, 'revertReason=', revertReason)

        if (success !== true) {
          // UI 给用户可读提示
          if (revertReason === 'AlreadyVoted') {
            setTxErr('You have already voted on this proposal.')
          } else if (revertReason === 'InvalidState' || revertReason === 'VotingClosed') {
            setTxErr('Voting is not active for this proposal (closed or invalid state).')
          } else if (revertReason === 'NotMember') {
            setTxErr('You are not a DAO member (NotMember).')
          } else {
            setTxErr(`Vote failed: ${revertReason || 'unknown reason'}`)
          }
          return
        }

        // 只有真正 success 才显示成功
        setTxMsg(`Voted successfully. tx=${receipt.transactionHash}`)
        setErr('')
        await refreshProposal()
        return
      } catch (e: any) {
        console.error('vote error raw', e)
        console.error('vote error message', e?.message)
        console.error('vote error data', e?.data)
        console.error('vote error reason', e?.reason)
        console.error('vote error shortMessage', e?.shortMessage)

        setErr(e?.shortMessage || e?.reason || e?.message || String(e))
        return
      }
    } catch (e: any) {
      setTxErr(e?.message || String(e))
    } finally {
      setSending(false)
    }
  }


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

            <div style={{ marginTop: 14 }}>
              <button
                disabled={sending || !dep || !canVote} //Vote 按钮禁用直到 dep 存在
                className='btn btnPrimary'
                style={{ width: '100%' }}
                onClick={() => vote(1)}
              >
                {sending ? 'Sending…' : 'Vote YES (AA)'}
              </button>

              <button
                disabled={sending || !dep || !canVote}//Vote 按钮禁用直到 dep 存在
                className='btn'
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => vote(2)}
              >
                {sending ? 'Sending…' : 'Vote NO (AA)'}
              </button>

              <button
                disabled={sending || !dep || !canVote}
                className='btn'
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => vote(3)}
              >
                {sending ? 'Sending...' : 'Vote ABSTAIN (AA)'}
              </button>

              {!canVote && (
                <div style={{ marginTop: 10, color: 'rgba(255,255,255,.6)' }}>
                  Voting is not active. Current state: {stateLabel(st)}
                </div>
              )}

              {txMsg && (
                <div style={{ marginTop: 10, color: 'var(--green)' }}>
                  {txMsg}
                </div>
              )}

              {txErr && (
                <div style={{ marginTop: 10, color: 'rgba(255,77,90,.9)' }}>
                  {txErr}
                </div>
              )}
            </div>
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
