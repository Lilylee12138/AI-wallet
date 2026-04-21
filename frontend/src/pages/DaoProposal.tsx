import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import { ethers } from 'ethers'
import { getInjectedProvider, requestAccounts, getChainId } from '../lib/eth'
import { loadDeployments } from '../config/deployments'
import { buildUserOp, signUserOpEOA, sendUserOp } from '../lib/aa'
import { getStableMemberId } from '../lib/member'

const DAO_ABI = [
  'function getProposal(uint256) view returns (tuple(address proposer,uint64 startTime,uint64 endTime,string description,address target,uint256 value,bytes data,bytes32 metaHash,string metaURI,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,bool executed,bool finalized))',
  'function state(uint256) view returns (uint8)',
  'function castVoteAs(uint256 proposalId, uint8 support, bytes32 voterMemberId)',
  'function isMember(bytes32) view returns (bool)'
]

type ProposalView = {
  description: string
  start: number
  end: number
  executed: boolean
  finalized: boolean
  forVotes: number
  againstVotes: number
  abstainVotes: number
}

function parseProposalText(raw: string) {
  const text = (raw || '').trim()

  const lines = text.split('\n')
  const title = (lines[0] || 'Untitled Proposal').trim()
  const body = lines.slice(1).join('\n').trim()

  const knownHeaders = ['Motivation', 'Specification', 'Benefits', 'Risks', 'Timeline']
  const sections: Array<{ heading: string; content: string }> = []

  let currentHeading = 'Overview'
  let currentContent: string[] = []

  const pushSection = () => {
    const content = currentContent.join('\n').trim()
    if (content) {
      sections.push({
        heading: currentHeading,
        content
      })
    }
  }

  for (const line of body.split('\n')) {
    const trimmed = line.trim()

    if (knownHeaders.includes(trimmed)) {
      pushSection()
      currentHeading = trimmed
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  pushSection()

  if (!sections.length && body) {
    sections.push({
      heading: 'Overview',
      content: body
    })
  }

  return {
    title,
    sections
  }
}

function stateLabel(s: number) {
  if (s === 1) return 'Active'
  if (s === 2) return 'Passed'
  if (s === 3) return 'Rejected'
  if (s === 4) return 'Executed'
  return 'Pending'
}

function pct(part: number, total: number) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

function mapFriendlyDaoError(raw: string) {
  const msg = String(raw || '')

  if (msg.includes("AA21 didn't pay prefund")) {
    return {
      title: 'Not enough gas prefund',
      message:
        'This DAO vote could not be submitted because the smart wallet does not have enough prefund for the ERC-4337 operation. Please add more ETH to the wallet or deposit more ETH into the EntryPoint gas tank, then try again.'
    }
  }

  if (msg.includes('AlreadyVoted')) {
    return {
      title: 'You already voted',
      message:
        'This wallet has already voted on this proposal, so the transaction was rejected.'
    }
  }

  if (msg.includes('VotingClosed') || msg.includes('InvalidState')) {
    return {
      title: 'Voting is not active',
      message:
        'This proposal is not currently in an active voting state, so your vote cannot be submitted.'
    }
  }

  if (msg.includes('NotMember')) {
    return {
      title: 'Not a DAO member',
      message:
        'This wallet is not recognized as a DAO member, so it cannot vote on this proposal.'
    }
  }

  if (msg.includes('MetaMask not connected')) {
    return {
      title: 'Wallet not connected',
      message:
        'Your wallet is not connected. Please connect MetaMask first, then try again.'
    }
  }

  if (msg.includes('user rejected') || msg.includes('User denied')) {
    return {
      title: 'Transaction cancelled',
      message:
        'The transaction was cancelled in the wallet before it was submitted.'
    }
  }

  return {
    title: 'Transaction failed',
    message:
      'The vote could not be completed. Please check your wallet balance, gas tank balance, proposal status, and DAO membership status, then try again.'
  }
}

function shortenError(raw: string) {
  const text = String(raw || '')
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

function shortHash(v: string, left = 8, right = 6) {
  if (!v) return ''
  if (v.length <= left + right + 3) return v
  return `${v.slice(0, left)}...${v.slice(-right)}`
}

async function copyText(text: string) {
  if (!text) return

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {}

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

export default function DaoProposal() {
  const nav = useNavigate()
  const { id } = useParams()
  const pid = Number(id)
  const validPid = Number.isFinite(pid) && pid > 0

  const [dep, setDep] = useState<any>(null)
  const [proposal, setProposal] = useState<ProposalView | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')
  const [txHash, setTxHash] = useState('')
  const [copiedTx, setCopiedTx] = useState(false)
  const [err, setErr] = useState('')
  const [st, setSt] = useState(0)

  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const [friendlyErrorTitle, setFriendlyErrorTitle] = useState('')
  const [friendlyErrorMessage, setFriendlyErrorMessage] = useState('')

  const [aiExplaining, setAiExplaining] = useState(false)
  const [aiReply, setAiReply] = useState('')
  const [aiErr, setAiErr] = useState('')

  const canVote = st === 1

  async function loadDep() {
    const p = getInjectedProvider()
    await requestAccounts(p)
    const chainId = await getChainId(p)
    const d = await loadDeployments(chainId)
    setDep(d)
    return { p, d }
  }

  function showFriendlyError(raw: string) {
    const mapped = mapFriendlyDaoError(raw)
    setErr(raw)
    setFriendlyErrorTitle(mapped.title)
    setFriendlyErrorMessage(mapped.message)
    setErrorModalOpen(true)
  }

  async function refreshProposal() {
    setLoading(true)
    setErr('')

    try {
      if (!validPid) {
        throw new Error(`Invalid proposal id: ${String(id)}`)
      }

      const { p, d } = await loadDep()
      const dao = new ethers.Contract(d.diamondAccount, DAO_ABI, p)

      const pr = await dao.getProposal(pid)
      const state = await dao.state(pid)

      setProposal({
        description: String(pr.description || ''),
        start: Number(pr.startTime || 0),
        end: Number(pr.endTime || 0),
        executed: Boolean(pr.executed),
        finalized: Boolean(pr.finalized),
        forVotes: Number(pr.forVotes || 0),
        againstVotes: Number(pr.againstVotes || 0),
        abstainVotes: Number(pr.abstainVotes || 0)
      })

      setSt(Number(state))
    } catch (e: any) {
      const raw = e?.message || String(e)
      setErr(raw)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      await refreshProposal()
    })()
  }, [id])

  const parsed = useMemo(() => parseProposalText(proposal?.description || ''), [proposal?.description])

  const totalVotes =
    (proposal?.forVotes || 0) +
    (proposal?.againstVotes || 0) +
    (proposal?.abstainVotes || 0)

  const pageContext = useMemo(() => {
    return {
      path: window.location.pathname,
      page: 'dao_proposal',
      title: parsed.title,
      context: {
        proposalId: validPid ? pid : 0,
        title: parsed.title,
        sections: parsed.sections,
        description: proposal?.description || '',
        start: proposal?.start ?? 0,
        end: proposal?.end ?? 0,
        executed: proposal?.executed ?? false,
        finalized: proposal?.finalized ?? false,
        state: stateLabel(st),
        forVotes: proposal?.forVotes ?? 0,
        againstVotes: proposal?.againstVotes ?? 0,
        abstainVotes: proposal?.abstainVotes ?? 0,
        canVote,
        lastErrorRaw: err || '',
        lastErrorFriendlyTitle: friendlyErrorTitle || '',
        lastErrorFriendlyMessage: friendlyErrorMessage || ''
      }
    }
  }, [
    pid,
    validPid,
    parsed.title,
    parsed.sections,
    proposal,
    st,
    canVote,
    err,
    friendlyErrorTitle,
    friendlyErrorMessage
  ])

  useEffect(() => {
    sessionStorage.setItem('wallet_ai_context', JSON.stringify(pageContext))
  }, [pageContext])

  async function explainProposalWithAI() {
    if (!proposal) return

    setAiExplaining(true)
    setAiReply('')
    setAiErr('')

    try {
      const r = await fetch('http://127.0.0.1:8787/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:
            'Please explain this DAO proposal in a gentle, beginner-friendly way. Summarize what it wants to do, what the current status means, and what YES / NO / ABSTAIN would generally imply.',
          page: 'dao_proposal',
          context: pageContext.context,
          history: []
        })
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail || j?.error || 'llm chat error')

      setAiReply(j?.reply || '')
    } catch (e: any) {
      setAiErr(e?.message || String(e))
    } finally {
      setAiExplaining(false)
    }
  }

  async function vote(support: 1 | 2 | 3) {
    setSending(true)
    setMsg('')
    setTxHash('')
    setCopiedTx(false)
    setErr('')
    setFriendlyErrorTitle('')
    setFriendlyErrorMessage('')
    setErrorModalOpen(false)

    try {
      if (!validPid) {
        showFriendlyError(`Invalid proposal id: ${String(id)}`)
        return
      }

      const { p, d } = await loadDep()
      const accounts = await p.listAccounts()
      if (!accounts.length) throw new Error('MetaMask not connected')
      const beneficiary = accounts[0]

      const { memberId } = await getStableMemberId(p)
      const mid = memberId

      const daoRead = new ethers.Contract(
        d.diamondAccount,
        ['function isMember(bytes32) view returns (bool)'],
        p
      )

      const ok = await daoRead.isMember(mid)
      if (!ok) {
        showFriendlyError('NotMember')
        return
      }

      const daoIface = new ethers.utils.Interface([
        'function castVoteAs(uint256 proposalId, uint8 support, bytes32 voterMemberId)'
      ])

      const callData = daoIface.encodeFunctionData('castVoteAs', [pid, support, mid])

      const { userOp, userOpHash } = await buildUserOp({
        provider: p,
        entryPoint: d.entryPoint,
        diamond: d.diamondAccount,
        callData
      })

      userOp.signature = await signUserOpEOA({ provider: p, userOpHash })

      const { receipt, success, revertReason } = await sendUserOp({
        provider: p,
        entryPoint: d.entryPoint,
        beneficiary,
        userOp,
        userOpHash
      })

      if (success !== true) {
        if (revertReason === 'AlreadyVoted') {
          showFriendlyError('AlreadyVoted')
        } else if (revertReason === 'InvalidState' || revertReason === 'VotingClosed') {
          showFriendlyError(String(revertReason))
        } else if (revertReason === 'NotMember') {
          showFriendlyError('NotMember')
        } else {
          showFriendlyError(`Vote failed: ${revertReason || 'unknown reason'}`)
        }
        return
      }

      setMsg('Voted successfully')
      setTxHash(receipt.transactionHash)
      await refreshProposal()
    } catch (e: any) {
      const raw = e?.shortMessage || e?.reason || e?.message || String(e)
      showFriendlyError(raw)
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout
      title='DAO Proposal'
      right={
        <button className='btn btnGhost' onClick={() => nav('/dao')}>
          ←
        </button>
      }
    >
      {errorModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div
            className='card'
            style={{
              width: 'min(520px, 100%)',
              padding: 18,
              borderColor: 'rgba(255,77,90,.25)',
              boxShadow: '0 24px 80px rgba(0,0,0,.35)'
            }}
          >
            <div
              className='row'
              style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <div className='h2' style={{ color: 'rgba(255,220,220,.96)' }}>
                {friendlyErrorTitle || 'Transaction failed'}
              </div>

              <button
                className='btn btnGhost'
                onClick={() => setErrorModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div
              className='small'
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                opacity: 0.92
              }}
            >
              {friendlyErrorMessage}
            </div>

            {err && (
              <div
                className='small'
                style={{
                  marginTop: 14,
                  opacity: 0.68,
                  whiteSpace: 'pre-wrap'
                }}
              >
                Raw error: {shortenError(err)}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button
                className='btn btnPrimary'
                onClick={() => setErrorModalOpen(false)}
                style={{ width: '100%' }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <div className='card' style={{ padding: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div className='h2' style={{ flex: 1 }}>
            {parsed.title}
          </div>

          <div
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,.10)',
              background: 'rgba(255,255,255,.04)',
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            {loading ? 'Loading' : stateLabel(st)}
          </div>
        </div>

        {proposal && (
          <div className='small' style={{ marginTop: 10, opacity: 0.82 }}>
            start: {proposal.start} • end: {proposal.end} • executed: {String(proposal.executed)} • finalized: {String(proposal.finalized)}
          </div>
        )}

        <div
          className='cardSoft'
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 24
          }}
        >
          <div className='small' style={{ fontWeight: 700, opacity: 0.88 }}>
            AI Summary
          </div>

          <div className='small' style={{ marginTop: 8, opacity: 0.82 }}>
            Ask AI to explain this proposal, its current status, and what the voting options mean.
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              className='btn btnGhost'
              onClick={explainProposalWithAI}
              disabled={aiExplaining || loading || !proposal}
            >
              {aiExplaining ? 'Explaining…' : 'Explain this proposal with AI'}
            </button>
          </div>

          {aiReply && (
            <div
              className='small'
              style={{
                marginTop: 14,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                opacity: 0.92
              }}
            >
              {aiReply}
            </div>
          )}

          {aiErr && (
            <div style={{ marginTop: 10, color: 'rgba(255,77,90,.92)' }}>
              AI explain error: {aiErr}
            </div>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <div className='h2' style={{ fontSize: 22 }}>
            Proposal Details
          </div>

          {parsed.sections.length > 0 ? (
            <div className='col g12' style={{ marginTop: 14 }}>
              {parsed.sections.map((sec, idx) => (
                <div
                  key={`${sec.heading}-${idx}`}
                  className='cardSoft'
                  style={{
                    padding: 14,
                    borderRadius: 20
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 18,
                      marginBottom: 10
                    }}
                  >
                    {sec.heading}
                  </div>

                  <div
                    className='small'
                    style={{
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.8,
                      opacity: 0.9
                    }}
                  >
                    {sec.content}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className='small' style={{ marginTop: 12, opacity: 0.72 }}>
              No proposal body available.
            </div>
          )}
        </div>

        <div className='col g12' style={{ marginTop: 20 }}>
          <button
            className='btn btnPrimary'
            onClick={() => vote(1)}
            disabled={sending || loading || !canVote}
          >
            {sending ? 'Sending…' : 'Vote YES (AA)'}
          </button>

          <button
            className='btn'
            onClick={() => vote(2)}
            disabled={sending || loading || !canVote}
          >
            {sending ? 'Sending…' : 'Vote NO (AA)'}
          </button>

          <button
            className='btn'
            onClick={() => vote(3)}
            disabled={sending || loading || !canVote}
          >
            {sending ? 'Sending…' : 'Vote ABSTAIN (AA)'}
          </button>

          {!canVote && !loading && (
            <div style={{ marginTop: 10, color: 'rgba(255,255,255,.6)' }}>
              Voting is not active. Current state: {stateLabel(st)}
            </div>
          )}
        </div>
      </div>

      <div className='card' style={{ padding: 16, marginTop: 16 }}>
        <div className='h2'>Current Results</div>

        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6
            }}
          >
            <div className='small'>Yes / For</div>
            <div className='small'>{pct(proposal?.forVotes || 0, totalVotes)}%</div>
          </div>
          <div
            style={{
              height: 18,
              borderRadius: 999,
              background: 'rgba(255,255,255,.08)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${pct(proposal?.forVotes || 0, totalVotes)}%`,
                height: '100%',
                borderRadius: 999,
                background: 'linear-gradient(90deg, #45e6b8, #5aa0ff)'
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6
            }}
          >
            <div className='small'>No / Against</div>
            <div className='small'>{pct(proposal?.againstVotes || 0, totalVotes)}%</div>
          </div>
          <div
            style={{
              height: 18,
              borderRadius: 999,
              background: 'rgba(255,255,255,.08)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${pct(proposal?.againstVotes || 0, totalVotes)}%`,
                height: '100%',
                borderRadius: 999,
                background: 'rgba(255,255,255,.18)'
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6
            }}
          >
            <div className='small'>Abstain</div>
            <div className='small'>{pct(proposal?.abstainVotes || 0, totalVotes)}%</div>
          </div>
          <div
            style={{
              height: 18,
              borderRadius: 999,
              background: 'rgba(255,255,255,.08)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${pct(proposal?.abstainVotes || 0, totalVotes)}%`,
                height: '100%',
                borderRadius: 999,
                background: 'rgba(255,255,255,.12)'
              }}
            />
          </div>
        </div>

        <div className='small' style={{ marginTop: 16, opacity: 0.82 }}>
          totals: for {proposal?.forVotes || 0} • against {proposal?.againstVotes || 0} • abstain {proposal?.abstainVotes || 0}
        </div>

        {msg && (
          <div
            className='cardSoft'
            style={{
              marginTop: 12,
              padding: 12,
              border: '1px solid rgba(90,255,210,.18)',
              background: 'rgba(90,255,210,.06)',
            }}
          >
            <div style={{ color: 'var(--green)', fontWeight: 800 }}>
              {msg}
            </div>

            {txHash && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div
                  className='small'
                  style={{
                    color: 'rgba(255,255,255,.82)',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    flex: 1,
                  }}
                >
                  Tx: {shortHash(txHash)}
                </div>

                <button
                  type='button'
                  className='btn btnGhost'
                  style={{ minWidth: 0, padding: '6px 10px' }}
                  onClick={async () => {
                    await copyText(txHash)
                    setCopiedTx(true)
                    window.setTimeout(() => setCopiedTx(false), 1200)
                  }}
                >
                  {copiedTx ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        )}

        {err && <div style={{ marginTop: 12, color: 'rgba(255,77,90,.92)' }}>{err}</div>}
      </div>
    </Layout>
  )
}