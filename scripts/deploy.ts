import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

async function main() {
  const signers = await ethers.getSigners()
  const ownerIndex = Number(process.env.OWNER_INDEX ?? "0")
  const owner = signers[ownerIndex]
  if (!owner) throw new Error(`Invalid OWNER_INDEX=${ownerIndex}, signers.length=${signers.length}`)

  console.log("Deploying with owner index:", ownerIndex)
  console.log("Deploying with owner:", owner.address)

  // 1) Deploy EntryPoint
  const EntryPoint = await ethers.getContractFactory("EntryPoint")
  const entryPoint = await EntryPoint.deploy()
  await entryPoint.deployed()
  console.log("EntryPoint:", entryPoint.address)

  // 2) Deploy DiamondAccount
  const DiamondAccount = await ethers.getContractFactory("DiamondAccount")
  const diamond = await DiamondAccount.deploy(owner.address)
  await diamond.deployed()
  console.log("DiamondAccount:", diamond.address)

  // set entryPoint (fix EntryPointNotSet)
  const txSetEP = await diamond.connect(owner).setEntryPoint(entryPoint.address)
  await txSetEP.wait()
  console.log("[diamond] setEntryPoint:", entryPoint.address)

  // 3) Deploy facets
  const ValidationFacet = await ethers.getContractFactory("ValidationFacet")
  const validationFacet = await ValidationFacet.deploy()
  await validationFacet.deployed()

  const ExecutionFacet = await ethers.getContractFactory("ExecutionFacet")
  const executionFacet = await ExecutionFacet.deploy()
  await executionFacet.deployed()

  const IdentityFacet = await ethers.getContractFactory("IdentityFacet")
  const identityFacet = await IdentityFacet.deploy()
  await identityFacet.deployed()

  const DaoFacet = await ethers.getContractFactory("DaoFacet")
  const daoFacet = await DaoFacet.deploy()
  await daoFacet.deployed()

  const NonceFacet = await ethers.getContractFactory("NonceFacet")
  const nonceFacet = await NonceFacet.deploy()
  await nonceFacet.deployed()

  const EntryPointDepositFacet = await ethers.getContractFactory("EntryPointDepositFacet")
  const depositFacet = await EntryPointDepositFacet.deploy()
  await depositFacet.deployed()

  console.log("Facets deployed:")
  console.log("  ValidationFacet:", validationFacet.address)
  console.log("  ExecutionFacet:", executionFacet.address)
  console.log("  IdentityFacet:", identityFacet.address)
  console.log("  DaoFacet:", daoFacet.address)
  console.log("  NonceFacet:", nonceFacet.address)
  console.log("  EntryPointDepositFacet:", depositFacet.address)

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

  console.log("Facets registered")

  // 5) Bind critical selectors (avoid FacetNotSet)
  const daoCriticalSigs = [
    "seedProposalAsOwner(string,address,uint256,bytes,uint64,bytes32,string)",
    "propose(string,address,uint256,bytes,uint64,bytes32,string)",
    "castVoteAs(uint256,uint8,bytes32)",
    "castVote(uint256,uint8)",
    "getProposal(uint256)",
    "state(uint256)",
    "addMember(bytes32)",
    "isMember(bytes32)",
  ]
  for (const sig of daoCriticalSigs) {
    const sel = daoFacet.interface.getSighash(sig)
    const tx = await diamond.connect(owner).setFacet(sel, daoFacet.address)
    await tx.wait()
  }

  const depositCriticalSigs = [
    "getEntryPointDeposit()",
    "depositToEntryPoint()",
    "withdrawDepositTo(address,uint256)",
  ]
  for (const sig of depositCriticalSigs) {
    const sel = depositFacet.interface.getSighash(sig)
    const tx = await diamond.connect(owner).setFacet(sel, depositFacet.address)
    await tx.wait()
  }

  // 6) DAO members (MVP)
  const identityAsDiamond = new ethers.Contract(
    diamond.address,
    ["function currentMemberId() view returns (bytes32)"],
    owner
  )

  let ownerMemberId = ethers.constants.HashZero
  try { ownerMemberId = await identityAsDiamond.currentMemberId() } catch {}
  const addrBasedMid = ethers.utils.hexZeroPad(owner.address, 32)

  const daoAsDiamond = new ethers.Contract(diamond.address, ["function addMember(bytes32)"], owner)
  for (const mid of Array.from(new Set([ownerMemberId, ethers.constants.HashZero, addrBasedMid]))) {
    await (await daoAsDiamond.addMember(mid)).wait()
  }

  // 7) Seed proposals
  const daoSeed = new ethers.Contract(
    diamond.address,
    ["function seedProposalAsOwner(string,address,uint256,bytes,uint64,bytes32,string) returns (uint256)"],
    owner
  )

  const votingPeriod = 7 * 24 * 60 * 60
  const target = ethers.constants.AddressZero
  const value = 0
  const data = "0x"
  const metaHash = ethers.constants.HashZero

  const proposals: Array<[string, string]> = [
    ["TIP-40: Security Audit Funding", "Fund external audit firm."],
    ["TIP-41: Treasury Diversification", "Diversify treasury assets."],
    ["TIP-42: Liquidity Pool Update", "Update LP incentives."],
    ["TIP-43: Governance Upgrade", "Upgrade governance mechanism."],
    ["TIP-44: Passkey Adoption Incentive", "Incentivize passkey users."],
  ]

  for (const [title, desc] of proposals) {
    const description = `${title}\n\n${desc}`
    await (await daoSeed.seedProposalAsOwner(description, target, value, data, votingPeriod, metaHash, "")).wait()
  }

  // 8) Save + sync deployments
  const chainId = (await ethers.provider.getNetwork()).chainId
  const deployment = { chainId, entryPoint: entryPoint.address, diamondAccount: diamond.address }

  const rootDeployDir = path.join(__dirname, "../deployments")
  ensureDir(rootDeployDir)
  fs.writeFileSync(path.join(rootDeployDir, "31337.json"), JSON.stringify(deployment, null, 2))

  const feDeployDir = path.join(__dirname, "../frontend/public/deployments")
  ensureDir(feDeployDir)
  fs.writeFileSync(path.join(feDeployDir, "31337.json"), JSON.stringify(deployment, null, 2))

  console.log("Deployment saved + synced.")
  console.log("frontend/public/deployments/31337.json updated.")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
