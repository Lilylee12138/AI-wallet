import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

async function main() {
  const signers = await ethers.getSigners()
  const ownerIndex = Number(process.env.OWNER_INDEX ?? '0')
  const owner = signers[ownerIndex]
  if (!owner) throw new Error(`Invalid OWNER_INDEX=${ownerIndex}, signers.length=${signers.length}`)

  console.log('Deploying with owner index:', ownerIndex)
  console.log('Deploying with owner:', owner.address)

  // 1) Deploy EntryPoint
  const EntryPoint = await ethers.getContractFactory('EntryPoint')
  const entryPoint = await EntryPoint.deploy()
  await entryPoint.deployed()
  console.log('EntryPoint:', entryPoint.address)

  // 2) Deploy DiamondAccount
  const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
  const diamond = await DiamondAccount.deploy(owner.address)
  await diamond.deployed()
  console.log('DiamondAccount:', diamond.address)

  // set entryPoint (fix EntryPointNotSet)
  const txSetEP = await diamond.connect(owner).setEntryPoint(entryPoint.address)
  await txSetEP.wait()
  console.log('[diamond] setEntryPoint:', entryPoint.address)

  // 3) Deploy facets
  const ValidationFacet = await ethers.getContractFactory('ValidationFacet')
  const validationFacet = await ValidationFacet.deploy()
  await validationFacet.deployed()

  const ExecutionFacet = await ethers.getContractFactory('ExecutionFacet')
  const executionFacet = await ExecutionFacet.deploy()
  await executionFacet.deployed()

  const IdentityFacet = await ethers.getContractFactory('IdentityFacet')
  const identityFacet = await IdentityFacet.deploy()
  await identityFacet.deployed()

  const DaoFacet = await ethers.getContractFactory('DaoFacet')
  const daoFacet = await DaoFacet.deploy()
  await daoFacet.deployed()

  const NonceFacet = await ethers.getContractFactory('NonceFacet')
  const nonceFacet = await NonceFacet.deploy()
  await nonceFacet.deployed()

  const EntryPointDepositFacet = await ethers.getContractFactory('EntryPointDepositFacet')
  const depositFacet = await EntryPointDepositFacet.deploy()
  await depositFacet.deployed()

  // NEW： RiskOracleFacet (MVP)
  const RiskOracleFacet = await ethers.getContractFactory('RiskOracleFacet')
  const riskOracleFacet = await RiskOracleFacet.deploy()
  await riskOracleFacet.deployed()

  // NEW： ConfigFacet (MVP)
  const ConfigFacet = await ethers.getContractFactory('ConfigFacet')
  const configFacet = await ConfigFacet.deploy()
  await configFacet.deployed()

  // NEW: DiamondOwnershipFacet (for ownership transfer, if needed in the future)
  const DiamondOwnershipFacet = await ethers.getContractFactory('DiamondOwnershipFacet')
  const diamondOwnershipFacet = await DiamondOwnershipFacet.deploy()
  await diamondOwnershipFacet.deployed()

  // NEW: DiamondLoupeFacet (for introspection, not strictly needed for MVP)
  const DiamondLoupeFacet = await ethers.getContractFactory('DiamondLoupeFacet')
  const diamondLoupeFacet = await DiamondLoupeFacet.deploy()
  await diamondLoupeFacet.deployed()

  // NEW: Lightweight DiamondCutFacet
  const DiamondCutFacet = await ethers.getContractFactory('DiamondCutFacet')
  const diamondCutFacet = await DiamondCutFacet.deploy()
  await diamondCutFacet.deployed()

  console.log('Facets deployed:')
  console.log('  ValidationFacet:', validationFacet.address)
  console.log('  ExecutionFacet:', executionFacet.address)
  console.log('  IdentityFacet:', identityFacet.address)
  console.log('  DaoFacet:', daoFacet.address)
  console.log('  NonceFacet:', nonceFacet.address)
  console.log('  EntryPointDepositFacet:', depositFacet.address)
  console.log('  RiskOracleFacet:', riskOracleFacet.address)
  console.log('  ConfigFacet:', configFacet.address)
  console.log('  DiamondOwnershipFacet:', diamondOwnershipFacet.address)
  console.log('  DiamondLoupeFacet:', diamondLoupeFacet.address)
  console.log('  DiamondCutFacet:', diamondCutFacet.address)

  // 4) Register facets via setFacet
  async function registerFacet(facet: any) {
    const selectors = Object.keys(facet.interface.functions).map((fn) => facet.interface.getSighash(fn))
    for (const sel of selectors) {
      const tx = await diamond.connect(owner).setFacet(sel, facet.address)
      await tx.wait()
    }
  }

  await registerFacet(validationFacet)
  await registerFacet(executionFacet)
  await registerFacet(identityFacet)
  await registerFacet(daoFacet)
  await registerFacet(nonceFacet)
  await registerFacet(depositFacet)
  await registerFacet(riskOracleFacet)
  await registerFacet(configFacet)
  await registerFacet(diamondOwnershipFacet)
  await registerFacet(diamondLoupeFacet)
  await registerFacet(diamondCutFacet)

  console.log('Facets registered')

  // NEW: Configure Risk Oracle (MVP)
  // By default we use signer[1] as oracle (override by env ORACLE_INDEX)
  const oracleIndex = Number(process.env.ORACLE_INDEX ?? '1')
  const oracle = signers[oracleIndex]
  if (!oracle) throw new Error(`Invalid ORACLE_INDEX=${oracleIndex}, signers.length=${signers.length}`)

  const riskAsDiamond = new ethers.Contract(
    diamond.address,
    [
      'function setOracleSigner(address)',
      'function setRiskThresholdBps(uint16)',
      'function getOracleSigner() view returns (address)',
      'function getRiskThresholdBps() view returns (uint16)',
    ],
    owner
  )

  const thresholdBps = Number(process.env.RISK_THRESHOLD_BPS ?? '3000')
  await (await riskAsDiamond.setOracleSigner(oracle.address)).wait()
  await (await riskAsDiamond.setRiskThresholdBps(thresholdBps)).wait()
  console.log('[risk] oracleSigner:', await riskAsDiamond.getOracleSigner())
  console.log('[risk] thresholdBps:', await riskAsDiamond.getRiskThresholdBps())

  // NEW: Initialize ConfigFacet defaults
  try {
    const configAsDiamond = new ethers.Contract(
      diamond.address,
      [
        'function initConfigDefaults()',
        'function getConfig() view returns (uint16,uint8,bool,bool,bool)',
      ],
      owner
    )

    await (await configAsDiamond.initConfigDefaults()).wait()
    const cfg = await configAsDiamond.getConfig()

    console.log('[config] initialized')
    console.log('[config] riskThresholdBps:', cfg[0].toString())
    console.log('[config] validationMode:', cfg[1].toString())
    console.log('[config] aiExplainEnabled:', cfg[2])
    console.log('[config] swapAdviceEnabled:', cfg[3])
    console.log('[config] initialized flag:', cfg[4])
  } catch (e: any) {
    console.warn('[config] init skipped or failed:', e?.message || String(e))
  }

  // 5) Bind critical selectors (avoid FacetNotSet)
  const daoCriticalSigs = [
    'seedProposalAsOwner(string,address,uint256,bytes,uint64,bytes32,string)',
    'propose(string,address,uint256,bytes,uint64,bytes32,string)',
    'castVoteAs(uint256,uint8,bytes32)',
    'castVote(uint256,uint8)',
    'getProposal(uint256)',
    'state(uint256)',
    'addMember(bytes32)',
    'isMember(bytes32)',
  ]
  for (const sig of daoCriticalSigs) {
    const sel = daoFacet.interface.getSighash(sig)
    const tx = await diamond.connect(owner).setFacet(sel, daoFacet.address)
    await tx.wait()
  }

  const depositCriticalSigs = [
    'getEntryPointDeposit()',
    'depositToEntryPoint()',
    'withdrawDepositTo(address,uint256)',
  ]
  for (const sig of depositCriticalSigs) {
    const sel = depositFacet.interface.getSighash(sig)
    const tx = await diamond.connect(owner).setFacet(sel, depositFacet.address)
    await tx.wait()
  }

  // 6) DAO members (MVP)
  const identityAsDiamond = new ethers.Contract(
    diamond.address,
    ['function currentMemberId() view returns (bytes32)'],
    owner
  )

  let ownerMemberId = ethers.constants.HashZero
  try { ownerMemberId = await identityAsDiamond.currentMemberId() } catch {}
  const addrBasedMid = ethers.utils.hexZeroPad(owner.address, 32)

  const daoAsDiamond = new ethers.Contract(diamond.address, ['function addMember(bytes32)'], owner)
  for (const mid of Array.from(new Set([ownerMemberId, ethers.constants.HashZero, addrBasedMid]))) {
    await (await daoAsDiamond.addMember(mid)).wait()
  }

  // 7) Seed proposals
  const daoSeed = new ethers.Contract(
    diamond.address,
    ['function seedProposalAsOwner(string,address,uint256,bytes,uint64,bytes32,string) returns (uint256)'],
    owner
  )

  const votingPeriod = 7 * 24 * 60 * 60
  const target = ethers.constants.AddressZero
  const value = 0
  const data = '0x'
  const metaHash = ethers.constants.HashZero

  const proposals: Array<[string, string]> = [
    [
      'TIP-40: Security Audit Funding',
      `Motivation
  The protocol is preparing for broader public testing and future feature expansion. Before scaling usage, the smart wallet contracts and governance modules should undergo an external security review.

  Specification
  This proposal requests treasury funding to commission an external audit firm to review the ERC-4337 account abstraction flow, Diamond facet interactions, governance voting logic, and risk attestation validation.

  Benefits
  - Improves protocol security
  - Reduces deployment risk
  - Increases user trust

  Risks
  - Treasury spending will increase in the short term
  - Audit recommendations may require additional development work

  Timeline
  If approved, the audit process should begin immediately after proposal finalization.`
    ],
    [
      'TIP-41: Treasury Diversification',
      `Motivation
  The treasury is currently concentrated in a limited set of assets. This creates unnecessary exposure to single-asset volatility and reduces flexibility for future ecosystem spending.

  Specification
  This proposal recommends gradually diversifying treasury holdings across stable assets and ecosystem-aligned reserve assets. The goal is to improve resilience while maintaining sufficient liquidity for protocol operations and incentives.

  Benefits
  - Reduces treasury concentration risk
  - Improves financial stability
  - Supports long-term sustainability

  Risks
  - Diversification decisions may underperform short-term market moves
  - Requires governance oversight on treasury policy

  Timeline
  Execution should begin in phases after approval, with regular governance review of treasury allocation changes.`
    ],
    [
      'TIP-42: Liquidity Pool Update',
      `Motivation
  Current liquidity incentives may not sufficiently support healthy swap routing conditions for protocol-integrated assets. Improving liquidity depth can reduce price impact and enhance user swap experience.

  Specification
  This proposal introduces an updated liquidity incentive program for selected pairs, with focus on improving depth in core governance and stable asset pools. Incentives should prioritize sustainable liquidity rather than short-term farming activity.

  Benefits
  - Improves swap execution quality
  - Reduces price impact for users
  - Creates better conditions for route analysis and AI-assisted swap recommendations

  Risks
  - Incentives may attract temporary liquidity only
  - Treasury usage must be monitored

  Timeline
  The new liquidity policy should be activated after governance approval and reviewed periodically based on pool performance.`
    ],
    [
      'TIP-43: Governance Upgrade',
      `Motivation
  The existing governance process is functional but minimal. As the protocol grows, governance should become more transparent, predictable, and secure.

  Specification
  This proposal upgrades governance procedures by introducing stronger proposal review standards, clearer quorum expectations, and improved execution safeguards. Future governance proposals should include structured sections such as motivation, specification, risks, and expected impact.

  Benefits
  - Improves governance quality
  - Makes proposals easier for users and AI assistants to interpret
  - Reduces ambiguity in decision-making

  Risks
  - Governance may become slightly slower
  - Contributors may need to adapt to more formal proposal standards

  Timeline
  The upgraded proposal standard should apply to future governance actions immediately after approval.`
    ],
    [
      'TIP-44: Passkey Adoption Incentive',
      `Motivation
  Passkey-based authentication can improve usability and security for smart contract wallets. However, user adoption may remain slow without clear incentives.

  Specification
  This proposal introduces a limited incentive program for users who activate passkey authentication and complete wallet onboarding with secure recovery settings. The initiative aims to encourage better wallet security practices.

  Benefits
  - Promotes safer authentication methods
  - Improves wallet usability for non-technical users
  - Aligns with the protocol goal of combining AI assistance with secure account abstraction

  Risks
  - Incentive abuse must be monitored
  - Program design must avoid excessive treasury leakage

  Timeline
  If approved, the incentive campaign should begin in the next onboarding cycle and be reviewed after initial participation metrics are collected.`
    ]
  ]

  for (const [title, desc] of proposals) {
    const description = `${title}\n\n${desc}`
    await (await daoSeed.seedProposalAsOwner(description, target, value, data, votingPeriod, metaHash, '')).wait()
  }

  // 8) Save + sync deployments (merge mode, do not overwrite tokens/dex/pools)
  const chainId = (await ethers.provider.getNetwork()).chainId
  const fileName = `${chainId}.json`

  const rootDeployDir = path.join(__dirname, '../deployments')
  ensureDir(rootDeployDir)
  const rootFile = path.join(rootDeployDir, fileName)

  let deployment: any = {}
  if (fs.existsSync(rootFile)) {
    deployment = JSON.parse(fs.readFileSync(rootFile, 'utf8'))
  }

  // only update fields owned by deploy.ts
  deployment.chainId = chainId
  deployment.entryPoint = entryPoint.address
  deployment.diamondAccount = diamond.address

  fs.writeFileSync(rootFile, JSON.stringify(deployment, null, 2))

  const feDeployDir = path.join(__dirname, '../frontend/public/deployments')
  ensureDir(feDeployDir)
  const feFile = path.join(feDeployDir, fileName)

  fs.writeFileSync(feFile, JSON.stringify(deployment, null, 2))

  console.log('Deployment merged + synced.')
  console.log('root deployment :', rootFile)
  console.log('frontend deployment :', feFile)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
