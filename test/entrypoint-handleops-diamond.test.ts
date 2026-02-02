import { expect } from 'chai'
import { ethers } from 'hardhat'
import { fillSignAndPack } from './UserOp'

describe('EntryPoint.handleOps -> DiamondAccount (Validation + Execution + Nonce)', function () {
  it('should validate and execute via mode=0 (EOA) via handleOps', async function () {
    const [deployer, owner, beneficiary] = await ethers.getSigners()

    const EntryPoint = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPoint.deploy()
    await entryPoint.deployed()

    const Counter = await ethers.getContractFactory('Counter')
    const counter = await Counter.deploy()
    await counter.deployed()

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

    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    expect(await diamond.owner()).to.equal(owner.address)

    await (await diamond.connect(owner).setEntryPoint(entryPoint.address)).wait()

    const execSelector = execFacet.interface.getSighash('execute')
    await (await diamond.connect(owner).setFacet(execSelector, execFacet.address)).wait()

    const getNonceSelector = nonceFacet.interface.getSighash('getNonce')
    const useNonceSelector = nonceFacet.interface.getSighash('useNonce')
    await (await diamond.connect(owner).setFacet(getNonceSelector, nonceFacet.address)).wait()
    await (await diamond.connect(owner).setFacet(useNonceSelector, nonceFacet.address)).wait()

    const validateSelector = validationFacet.interface.getSighash('validateUserOp')
    await (await diamond.connect(owner).setFacet(validateSelector, validationFacet.address)).wait()

    // IdentityFacet selectors (merged registration logic)
    const sel = (sig: string) => ethers.utils.id(sig).slice(0, 10)
    const idFacetAddr = identityFacet.address

    const idSelectors = [
      sel('setTrustedIssuer(address)'),
      sel('getTrustedIssuer()'),
      sel('registerPasskey(bytes32,bytes32)'),
      sel('disablePasskey(bytes32)'),
      sel('isPasskeyEnabled(bytes32)'),
      sel('getPasskeyRpIdHash(bytes32)'),
      sel('setSession(address,uint48,uint32,uint64)'),
      sel('revokeSession(address)'),
      sel('getSession(address)')
    ]

    for (const s of idSelectors) {
      await (await diamond.connect(owner).setFacet(s, idFacetAddr)).wait()
    }

    await (await deployer.sendTransaction({ to: diamond.address, value: ethers.utils.parseEther('1') })).wait()

    const diamondAsExec = ExecutionFacet.attach(diamond.address)
    const incrementData = counter.interface.encodeFunctionData('increment')
    const callData = diamondAsExec.interface.encodeFunctionData('execute', [counter.address, 0, incrementData])

    const packedOp = await fillSignAndPack(
      {
        sender: diamond.address,
        callData
      },
      owner,
      entryPoint
    )

    // mode=0 prefix for ValidationFacet
    packedOp.signature = ethers.utils.hexConcat(['0x00', packedOp.signature])

    await (await entryPoint.handleOps([packedOp], beneficiary.address)).wait()

    expect(await counter.number()).to.equal(1)
  })

  it('should validate and execute via mode=1 (passkey session) via handleOps', async function () {
    const [deployer, owner, beneficiary] = await ethers.getSigners()

    const EntryPoint = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPoint.deploy()
    await entryPoint.deployed()

    const Counter = await ethers.getContractFactory('Counter')
    const counter = await Counter.deploy()
    await counter.deployed()

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

    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    expect(await diamond.owner()).to.equal(owner.address)

    await (await diamond.connect(owner).setEntryPoint(entryPoint.address)).wait()

    const execSelector = execFacet.interface.getSighash('execute')
    await (await diamond.connect(owner).setFacet(execSelector, execFacet.address)).wait()

    const getNonceSelector = nonceFacet.interface.getSighash('getNonce')
    const useNonceSelector = nonceFacet.interface.getSighash('useNonce')
    await (await diamond.connect(owner).setFacet(getNonceSelector, nonceFacet.address)).wait()
    await (await diamond.connect(owner).setFacet(useNonceSelector, nonceFacet.address)).wait()

    const validateSelector = validationFacet.interface.getSighash('validateUserOp')
    await (await diamond.connect(owner).setFacet(validateSelector, validationFacet.address)).wait()

    // IdentityFacet selectors (merged registration logic)
    const sel = (sig: string) => ethers.utils.id(sig).slice(0, 10)
    const idFacetAddr = identityFacet.address

    const idSelectors = [
      sel('setTrustedIssuer(address)'),
      sel('getTrustedIssuer()'),
      sel('registerPasskey(bytes32,bytes32)'),
      sel('disablePasskey(bytes32)'),
      sel('isPasskeyEnabled(bytes32)'),
      sel('getPasskeyRpIdHash(bytes32)'),
      sel('setSession(address,uint48,uint32,uint64)'),
      sel('revokeSession(address)'),
      sel('getSession(address)')
    ]

    for (const s of idSelectors) {
      await (await diamond.connect(owner).setFacet(s, idFacetAddr)).wait()
    }

    await (await deployer.sendTransaction({ to: diamond.address, value: ethers.utils.parseEther('1') })).wait()

    // Configure identity (Route A: issuer signs authorization after offchain WebAuthn)
    const identity = await ethers.getContractAt('IdentityFacet', diamond.address, owner)

    const issuer = ethers.Wallet.createRandom().connect(ethers.provider)
    await (await owner.sendTransaction({ to: issuer.address, value: ethers.utils.parseEther('0.05') })).wait()

    await (await identity.setTrustedIssuer(issuer.address)).wait()

    const credentialIdHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("cred-passkey-1"))
    const rpIdHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("rpId-example"))
    await (await identity.registerPasskey(credentialIdHash, rpIdHash)).wait()

    const sessionSigner = ethers.Wallet.createRandom().address
    const block = await ethers.provider.getBlock('latest')
    const now = block?.timestamp ?? 0
    const validUntil = now + 3600
    const scope = 0
    await (await identity.setSession(sessionSigner, validUntil, scope, 0)).wait()

    // Build callData: diamond.execute(counter.increment)
    const diamondAsExec = ExecutionFacet.attach(diamond.address)
    const incrementData = counter.interface.encodeFunctionData('increment')
    const callData = diamondAsExec.interface.encodeFunctionData('execute', [counter.address, 0, incrementData])

    const packedOp = await fillSignAndPack(
      {
        sender: diamond.address,
        callData
      },
      owner,
      entryPoint
    )

    // Compute userOpHash as EntryPoint does
    const userOpHash = await entryPoint.getUserOpHash(packedOp)

    // Issuer signature must match ValidationFacet:
    // msgHash = keccak256(abi.encodePacked("AA_SESSION_AUTH_V1", diamond, mode, userOpHash, sessionSigner, validUntil, scope, sessionNonce))
    // issuerSig = eth_sign(msgHash)
    const MODE_PASSKEY_SESSION = 1
    const sessionNonce = 1

    const msgHash = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['string', 'address', 'uint8', 'bytes32', 'address', 'uint48', 'uint32', 'uint64'],
        ['AA_SESSION_AUTH_V1', diamond.address, MODE_PASSKEY_SESSION, userOpHash, sessionSigner, validUntil, scope, sessionNonce]
      )
    )

    const issuerSig = await issuer.signMessage(ethers.utils.arrayify(msgHash))

    // mode=1 payload:
    // abi.encode(bytes32 credentialIdHash, address sessionSigner, uint48 validUntil, uint32 scope, uint64 sessionNonce, bytes issuerSig)
    const payload = ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint48', 'uint32', 'uint64', 'bytes'],
      [credentialIdHash, sessionSigner, validUntil, scope, sessionNonce, issuerSig]
    )

    packedOp.signature = ethers.utils.hexConcat(['0x01', payload])

    await (await entryPoint.handleOps([packedOp], beneficiary.address)).wait()

    expect(await counter.number()).to.equal(1)
  })
})
