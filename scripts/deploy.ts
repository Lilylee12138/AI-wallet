import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'
function ensureDir(p: string) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true })
  }
}

function selectorOf(sig: string) {
  return ethers.utils.id(sig).slice(0, 10)
}

async function main() {
  const [deployer, owner] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()
  const chainId = net.chainId

  console.log('chainId =', chainId)
  console.log('deployer =', deployer.address)
  console.log('owner =', owner.address)

  let entryPointAddr = ''

  if (chainId === 31337) {
    const EntryPoint = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPoint.deploy()
    await entryPoint.deployed()
    entryPointAddr = entryPoint.address
    console.log('EntryPoint (local) =', entryPointAddr)
  } else {
    entryPointAddr = process.env.SEPOLIA_ENTRYPOINT || ''
    if (!entryPointAddr) {
      throw new Error('Missing SEPOLIA_ENTRYPOINT in .env')
    }
    console.log('EntryPoint (external) =', entryPointAddr)
  }

  const Counter = await ethers.getContractFactory('Counter')
  const counter = await Counter.deploy()
  await counter.deployed()
  console.log('Counter =', counter.address)

  const ExecutionFacet = await ethers.getContractFactory('ExecutionFacet')
  const execFacet = await ExecutionFacet.deploy()
  await execFacet.deployed()

  const NonceFacet = await ethers.getContractFactory('NonceFacet')
  const nonceFacet = await NonceFacet.deploy()
  await nonceFacet.deployed()

  const ValidationFacet = await ethers.getContractFactory('ValidationFacet')
  const validationFacet = await ValidationFacet.deploy()
  await validationFacet.deployed()

  const IdentityFacet = await ethers.getContractFactory('IdentityFacet')
  const identityFacet = await IdentityFacet.deploy()
  await identityFacet.deployed()

  const DaoFacet = await ethers.getContractFactory('DaoFacet')
  const daoFacet = await DaoFacet.deploy()
  await daoFacet.deployed()

  console.log('ExecutionFacet =', execFacet.address)
  console.log('NonceFacet =', nonceFacet.address)
  console.log('ValidationFacet =', validationFacet.address)
  console.log('IdentityFacet =', identityFacet.address)
  console.log('DaoFacet =', daoFacet.address)

  const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
  const diamond = await DiamondAccount.deploy(owner.address)
  await diamond.deployed()
  console.log('DiamondAccount =', diamond.address)

  await (await diamond.connect(owner).setEntryPoint(entryPointAddr)).wait()

  const set = async (sig: string, facetAddr: string) => {
    const sel = selectorOf(sig)
    await (await diamond.connect(owner).setFacet(sel, facetAddr)).wait()
  }

  await set('execute(address,uint256,bytes)', execFacet.address)
  await set('getNonce()', nonceFacet.address)
  await set('useNonce()', nonceFacet.address)

  await set(
    'validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)',
    validationFacet.address
  )

  const idSigs = [
    'setTrustedIssuer(address)',
    'getTrustedIssuer()',
    'registerPasskey(bytes32,bytes32)',
    'disablePasskey(bytes32)',
    'isPasskeyEnabled(bytes32)',
    'getPasskeyRpIdHash(bytes32)',
    'setSession(address,uint48,uint32,uint64)',
    'revokeSession(address)',
    'getSession(address)',
    'currentMemberId()'
  ]

  for (const sig of idSigs) {
    await set(sig, identityFacet.address)
  }

  const daoSigs = [
    'addMember(bytes32)',
    'isMember(bytes32)',
    'propose(string,address,uint256,bytes,uint64,bytes32,string)',
    'castVote(uint256,uint8)',
    'finalize(uint256)',
    'execute(uint256)',
    'getProposal(uint256)',
    'state(uint256)',
    'seedProposalAsOwner(string,address,uint256,bytes,uint64,bytes32,string)'
  ]

  for (const sig of daoSigs) {
    await set(sig, daoFacet.address)
  }

  const trustedIssuer = process.env.TRUSTED_ISSUER || deployer.address
  const identity = await ethers.getContractAt('IdentityFacet', diamond.address)
  await (await identity.connect(owner).setTrustedIssuer(trustedIssuer)).wait()

  const dao = await ethers.getContractAt('DaoFacet', diamond.address)

  const memberA = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes('member:owner')
  )
  const memberB = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes('member:deployer')
  )

  await (await dao.connect(owner).addMember(memberA)).wait()
  await (await dao.connect(owner).addMember(memberB)).wait()

  const votingPeriod = 3600
  const emptyHash = ethers.constants.HashZero
  const metaURI = 'ipfs://demo'

  const counterIface = new ethers.utils.Interface(['function increment()'])
  const incData = counterIface.encodeFunctionData('increment')

  const seed = async (title: string) => {
    const tx = await dao.connect(owner).seedProposalAsOwner(
      title,
      counter.address,
      0,
      incData,
      votingPeriod,
      emptyHash,
      metaURI
    )
    await tx.wait()
  }

  await seed('TIP-40: Security Audit Funding')
  await seed('TIP-41: Treasury Diversification')
  await seed('TIP-42: Liquidity Pool Update')
  await seed('TIP-43: Gas Optimization Grant')
  await seed('TIP-44: Passkey Adoption Incentive')

  const out = {
    chainId,
    entryPoint: entryPointAddr,
    diamondAccount: diamond.address,
    counter: counter.address,
    owner: owner.address,
    facets: {
      ExecutionFacet: execFacet.address,
      NonceFacet: nonceFacet.address,
      ValidationFacet: validationFacet.address,
      IdentityFacet: identityFacet.address,
      DaoFacet: daoFacet.address
    }
  }

  const rootDeployDir = path.join(__dirname, '..', 'deployments')
  ensureDir(rootDeployDir)
  fs.writeFileSync(
    path.join(rootDeployDir, `${chainId}.json`),
    JSON.stringify(out, null, 2)
  )

  const feDeployDir = path.join(__dirname, '..', 'frontend', 'public', 'deployments')
  ensureDir(feDeployDir)
  fs.writeFileSync(
    path.join(feDeployDir, `${chainId}.json`),
    JSON.stringify(out, null, 2)
  )

  console.log('Deployment complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
