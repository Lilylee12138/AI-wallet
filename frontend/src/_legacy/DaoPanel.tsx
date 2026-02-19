import { useCallback, useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'

type Deployments = {
  chainId: number
  entryPoint: string
  diamond: string
  counter: string
  owner: string
  daoFacet?: string
}

type ProposalView = {
  id: number
  proposer: string
  startTime: number
  endTime: number
  description: string
  target: string
  value: string
  data: string
  metaHash: string
  metaURI: string
  forVotes: string
  againstVotes: string
  abstainVotes: string
  executed: boolean
  finalized: boolean
  state: number
}

type Props = {
  dep: Deployments | null
  provider: ethers.providers.JsonRpcProvider
  busy: boolean
  log: (s: string) => void
  buildAndSendUserOp: (callData: string) => Promise<void>
}

const DAO_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, bytes32 indexed proposerMemberId, string description)',
  'event VoteCast(uint256 indexed proposalId, bytes32 indexed voterMemberId, uint8 support)',
  'event ProposalFinalized(uint256 indexed proposalId, uint8 state)',
  'event ProposalExecuted(uint256 indexed proposalId)',

  'function addMember(bytes32 memberId)',
  'function propose(string description,address target,uint256 value,bytes data,uint64 votingPeriod,bytes32 metaHash,string metaURI) returns (uint256)',
  'function castVote(uint256 proposalId,uint8 support)',
  'function finalize(uint256 proposalId)',
  'function execute(uint256 proposalId)',
  'function state(uint256 proposalId) view returns (uint8)',

  'function getProposal(uint256 proposalId) view returns (tuple(address proposer,uint64 startTime,uint64 endTime,string description,address target,uint256 value,bytes data,bytes32 metaHash,string metaURI,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,bool executed,bool finalized))'
]

export default function DaoPanel (props: Props) {
  const { dep, provider, busy, log, buildAndSendUserOp } = props

  const dao = useMemo(() => {
    if (!dep) return null
    return new ethers.Contract(dep.diamond, DAO_ABI, provider)
  }, [dep, provider])

  const [proposals, setProposals] = useState<ProposalView[]>([])

  const [memberIdText, setMemberIdText] = useState('demo-member-1')

  const [newDesc, setNewDesc] = useState('DAO proposal via AA')
  const [votingPeriod, setVotingPeriod] = useState('60')

  const [voteProposalId, setVoteProposalId] = useState('1')
  const [voteSupport, setVoteSupport] = useState<'1' | '2' | '3'>('1')

  const [actionProposalId, setActionProposalId] = useState('1')

  const toMemberId = useCallback((s: string) => {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s))
  }, [])

  const refreshDao = useCallback(async () => {
    if (!dep || !dao) return
    try {
      const latest = await provider.getBlockNumber()

      const iface = new ethers.utils.Interface(DAO_ABI)
      const topicCreated = iface.getEventTopic('ProposalCreated')
      const logsCreated = await provider.getLogs({
        address: dep.diamond,
        fromBlock: 0,
        toBlock: latest,
        topics: [topicCreated]
      })

      const ids: number[] = []
      for (const l of logsCreated) {
        const parsed = iface.parseLog(l)
        const idBn = parsed.args.proposalId as ethers.BigNumber
        ids.push(idBn.toNumber())
      }

      const uniq = Array.from(new Set(ids)).sort((a, b) => a - b)

      const out: ProposalView[] = []
      for (const id of uniq) {
        const p = await dao.getProposal(id)
        const st: number = await dao.state(id)

        out.push({
          id,
          proposer: String(p.proposer),
          startTime: Number(p.startTime),
          endTime: Number(p.endTime),
          description: String(p.description),
          target: String(p.target),
          value: ethers.utils.formatEther(p.value),
          data: String(p.data),
          metaHash: String(p.metaHash),
          metaURI: String(p.metaURI),
          forVotes: String(p.forVotes),
          againstVotes: String(p.againstVotes),
          abstainVotes: String(p.abstainVotes),
          executed: Boolean(p.executed),
          finalized: Boolean(p.finalized),
          state: st
        })
      }

      setProposals(out)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('refreshDao error: ' + msg)
    }
  }, [dep, dao, provider, log])

  useEffect(() => {
    void refreshDao()
    const t = window.setInterval(() => {
      void refreshDao()
    }, 5000)
    return () => window.clearInterval(t)
  }, [refreshDao])

  const ownerAddMember = useCallback(async () => {
    if (!dep) return
    try {
      const id = toMemberId(memberIdText)
      const callData = new ethers.utils.Interface(DAO_ABI).encodeFunctionData('addMember', [id])
      await buildAndSendUserOp(callData)
      log('addMember userOp sent')
      await refreshDao()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('addMember error: ' + msg)
    }
  }, [dep, memberIdText, toMemberId, buildAndSendUserOp, log, refreshDao])

  const propose = useCallback(async () => {
    if (!dep) return
    try {
      const vp = Number(votingPeriod)
      const metaHash = ethers.constants.HashZero
      const metaURI = ''

      const callData = new ethers.utils.Interface(DAO_ABI).encodeFunctionData('propose', [
        newDesc,
        ethers.constants.AddressZero,
        0,
        '0x',
        vp,
        metaHash,
        metaURI
      ])

      await buildAndSendUserOp(callData)
      log('propose userOp sent')
      await refreshDao()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('propose error: ' + msg)
    }
  }, [dep, newDesc, votingPeriod, buildAndSendUserOp, log, refreshDao])

  const castVote = useCallback(async () => {
    if (!dep) return
    try {
      const id = Number(voteProposalId)
      const support = Number(voteSupport)

      const callData = new ethers.utils.Interface(DAO_ABI).encodeFunctionData('castVote', [id, support])
      await buildAndSendUserOp(callData)
      log('castVote userOp sent')
      await refreshDao()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('castVote error: ' + msg)
    }
  }, [dep, voteProposalId, voteSupport, buildAndSendUserOp, log, refreshDao])

  const finalize = useCallback(async () => {
    if (!dep) return
    try {
      const id = Number(actionProposalId)
      const callData = new ethers.utils.Interface(DAO_ABI).encodeFunctionData('finalize', [id])
      await buildAndSendUserOp(callData)
      log('finalize userOp sent')
      await refreshDao()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('finalize error: ' + msg)
    }
  }, [dep, actionProposalId, buildAndSendUserOp, log, refreshDao])

  const execute = useCallback(async () => {
    if (!dep) return
    try {
      const id = Number(actionProposalId)
      const callData = new ethers.utils.Interface(DAO_ABI).encodeFunctionData('execute', [id])
      await buildAndSendUserOp(callData)
      log('execute userOp sent')
      await refreshDao()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('execute error: ' + msg)
    }
  }, [dep, actionProposalId, buildAndSendUserOp, log, refreshDao])

  const stateText = (s: number) => {
    if (s === 0) return 'Pending'
    if (s === 1) return 'Active'
    if (s === 2) return 'Succeeded'
    if (s === 3) return 'Defeated'
    if (s === 4) return 'Executed'
    return String(s)
  }

  return (
    <div style={{ borderTop: '1px solid #ddd', paddingTop: 16 }}>
      <h3>DAO Panel</h3>

      <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Owner action: add member</div>
        <input
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
          value={memberIdText}
          onChange={(e) => setMemberIdText(e.target.value)}
          placeholder="memberId text"
        />
        <button disabled={busy} onClick={() => { void ownerAddMember() }}>Send UserOp addMember</button>
      </div>

      <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Create proposal</div>
        <input
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="description"
        />
        <input
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
          value={votingPeriod}
          onChange={(e) => setVotingPeriod(e.target.value)}
          placeholder="voting period seconds"
        />
        <button disabled={busy} onClick={() => { void propose() }}>Send UserOp propose</button>
      </div>

      <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Vote</div>
        <input
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
          value={voteProposalId}
          onChange={(e) => setVoteProposalId(e.target.value)}
          placeholder="proposalId"
        />
        <select
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
          value={voteSupport}
          onChange={(e) => setVoteSupport(e.target.value as '1' | '2' | '3')}
        >
          <option value="1">for</option>
          <option value="2">against</option>
          <option value="3">abstain</option>
        </select>
        <button disabled={busy} onClick={() => { void castVote() }}>Send UserOp castVote</button>
      </div>

      <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Finalize or execute</div>
        <input
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
          value={actionProposalId}
          onChange={(e) => setActionProposalId(e.target.value)}
          placeholder="proposalId"
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} onClick={() => { void finalize() }}>Send UserOp finalize</button>
          <button disabled={busy} onClick={() => { void execute() }}>Send UserOp execute</button>
          <button disabled={busy} onClick={() => { void refreshDao() }}>Refresh</button>
        </div>
      </div>

      <h3>Proposals (live)</h3>

      {proposals.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No proposals yet. Create one first.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {proposals.map((p) => (
            <div key={p.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Proposal #{p.id}</div>
                <div style={{ opacity: 0.8 }}>State: {stateText(p.state)}</div>
              </div>

              <div style={{ marginTop: 8 }}>{p.description}</div>

              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                start: {p.startTime} end: {p.endTime} executed: {String(p.executed)} finalized: {String(p.finalized)}
              </div>

              <div style={{ marginTop: 8 }}>
                votes for: {p.forVotes} against: {p.againstVotes} abstain: {p.abstainVotes}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
