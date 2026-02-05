import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'

async function main () {
  const [deployer, owner] = await ethers.getSigners()
  const chainId = (await ethers.provider.getNetwork()).chainId

  console.log('chainId =', chainId)
  console.log('deployer =', deployer.address)
  console.log('owner    =', owner.address)

  // 1. EntryPoint
  const EntryPoint = await ethers.getContractFactory('EntryPoint')
  const entryPoint = await EntryPoint.deploy()
  await entryPoint.deployed()
  console.log('EntryPoint =', entryPoint.address)

  // 2. Counter
  const Counter = await ethers.getContractFactory('Counter')
  const counter = await Counter.deploy()
  await counter.deployed()
  console.log('Counter =', counter.address)

  // 3. Facets
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

  console.log('ExecutionFacet =', execFacet.address)
  console.log('NonceFacet     =', nonceFacet.address)
  console.log('ValidationFacet=', validationFacet.address)
  console.log('IdentityFacet  =', identityFacet.address)

  // 4. DiamondAccount
  const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
  const diamond = await DiamondAccount.deploy(owner.address)
  await diamond.deployed()
  console.log('DiamondAccount =', diamond.address)

  // set EntryPoint
  await (await diamond.connect(owner).setEntryPoint(entryPoint.address)).wait()

  // 5. Register facets (setFacet)
  const set = async (sig: string, facetAddr: string) => {
    const selector = ethers.utils.id(sig).slice(0, 10)
    await (await diamond.connect(owner).setFacet(selector, facetAddr)).wait()
  }

  // Execution
  await set('execute(address,uint256,bytes)', execFacet.address)

  // Nonce
  await set('getNonce()', nonceFacet.address)
  await set('useNonce()', nonceFacet.address)

  // Validation
  await set(
    'validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)',
    validationFacet.address
  )

  // Identity
  const idSigs = [
    'setTrustedIssuer(address)',
    'getTrustedIssuer()',
    'registerPasskey(bytes32,bytes32)',
    'disablePasskey(bytes32)',
    'isPasskeyEnabled(bytes32)',
    'getPasskeyRpIdHash(bytes32)',
    'setSession(address,uint48,uint32,uint64)',
    'revokeSession(address)',
    'getSession(address)'
  ]

  for (const sig of idSigs) {
    await set(sig, identityFacet.address)
  }

  // 6. Save deployments/local.json
  const out = {
    chainId,
    entryPoint: entryPoint.address,
    diamond: diamond.address,
    counter: counter.address,
    owner: owner.address
  }

  const outDir = path.join(__dirname, '..', 'deployments')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)

  const outPath = path.join(outDir, 'local.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('saved to', outPath)

  // 7. Auto fund diamond to avoid AA21 prefund errors in demo
  try {
    const balBefore = await ethers.provider.getBalance(diamond.address)
    console.log('diamond balance before =', ethers.utils.formatEther(balBefore))

    const minBal = ethers.utils.parseEther('0.05')
    const fundValue = ethers.utils.parseEther('0.2')

    if (balBefore.lt(minBal)) {
      const txFund = await deployer.sendTransaction({ to: diamond.address, value: fundValue })
      await txFund.wait()
      const balAfter = await ethers.provider.getBalance(diamond.address)
      console.log('diamond funded, balance after =', ethers.utils.formatEther(balAfter))
    } else {
      console.log('diamond already has enough balance, skip funding')
    }
  } catch (e: any) {
    console.log('diamond funding skipped due to error:', e?.message ?? e)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
