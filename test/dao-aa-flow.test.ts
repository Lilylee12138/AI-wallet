import { expect } from 'chai'
import { ethers } from 'hardhat'

import { fillSignAndPack } from './UserOp'
import { wrapSigMode0 } from './helpers/aaSig'

describe('DAO governance via AA (memberId) + execution', function () {
  it('should propose, vote, finalize, and execute Counter.increment via EntryPoint.handleOps', async function () {
    const [deployer, owner, beneficiary] = await ethers.getSigners()

    // ------------------------------------------------------------
    // 1) Deploy EntryPoint
    // ------------------------------------------------------------
    const EntryPoint = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPoint.deploy()
    await entryPoint.deployed()

    // ------------------------------------------------------------
    // 2) Deploy target contract to be executed by DAO
    // ------------------------------------------------------------
    const Counter = await ethers.getContractFactory('Counter')
    const counter = await Counter.deploy()
    await counter.deployed()

    // ------------------------------------------------------------
    // 3) Deploy facets
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // 4) Deploy DiamondAccount
    // ------------------------------------------------------------
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    await (await diamond.connect(owner).setEntryPoint(entryPoint.address)).wait()

    // ------------------------------------------------------------
    // 5) Register base facets
    // ------------------------------------------------------------
    await (await diamond.connect(owner).setFacet(
      execFacet.interface.getSighash('execute'),
      execFacet.address
    )).wait()

    await (await diamond.connect(owner).setFacet(
      nonceFacet.interface.getSighash('getNonce'),
      nonceFacet.address
    )).wait()

    await (await diamond.connect(owner).setFacet(
      nonceFacet.interface.getSighash('useNonce'),
      nonceFacet.address
    )).wait()

    await (await diamond.connect(owner).setFacet(
      validationFacet.interface.getSighash('validateUserOp'),
      validationFacet.address
    )).wait()

    // IdentityFacet selectors (must include currentMemberId)
    const sel = (sig: string): string => ethers.utils.id(sig).slice(0, 10)
    const idSelectors = [
      sel('setTrustedIssuer(address)'),
      sel('getTrustedIssuer()'),
      sel('registerPasskey(bytes32,bytes32)'),
      sel('disablePasskey(bytes32)'),
      sel('isPasskeyEnabled(bytes32)'),
      sel('getPasskeyRpIdHash(bytes32)'),
      sel('setSession(address,uint48,uint32,uint64)'),
      sel('revokeSession(address)'),
      sel('getSession(address)'),
      sel('currentMemberId()'),
    ]
    for (const s of idSelectors) {
      await (await diamond.connect(owner).setFacet(s, identityFacet.address)).wait()
    }

    // DaoFacet selectors (register all functions including execute)
    for (const fn of Object.keys(daoFacet.interface.functions)) {
      const selector = daoFacet.interface.getSighash(fn)
      await (await diamond.connect(owner).setFacet(selector, daoFacet.address)).wait()
    }

    // ------------------------------------------------------------
    // 6) Fund DiamondAccount
    // ------------------------------------------------------------
    await (await deployer.sendTransaction({
      to: diamond.address,
      value: ethers.utils.parseEther('1')
    })).wait()

    const dao = await ethers.getContractAt('DaoFacet', diamond.address)
    const identity = await ethers.getContractAt('IdentityFacet', diamond.address)

    // ------------------------------------------------------------
    // 7) Warm up auth context via a harmless AA call
    // ------------------------------------------------------------
    const warmupCallData = identity.interface.encodeFunctionData('currentMemberId', [])

    let op = await fillSignAndPack(
      { sender: diamond.address, callData: warmupCallData },
      owner,
      entryPoint
    )
    op.signature = wrapSigMode0(op.signature)
    await (await entryPoint.handleOps([op], beneficiary.address)).wait()

    const memberId = await identity.currentMemberId()
    expect(memberId).to.not.equal(ethers.constants.HashZero)

    // ------------------------------------------------------------
    // 8) Add member (admin call)
    // ------------------------------------------------------------
    await (await dao.connect(owner).addMember(memberId)).wait()
    expect(await dao.isMember(memberId)).to.equal(true)

    // ------------------------------------------------------------
    // 9) Propose: action = Counter.increment()
    // ------------------------------------------------------------
    const incrementData = counter.interface.encodeFunctionData('increment')

    const proposeData = dao.interface.encodeFunctionData('propose', [
      'Execute Counter.increment via DAO+AA',
      counter.address,
      0,
      incrementData,
      5, // voting period seconds
      ethers.constants.HashZero,
      '',
    ])

    op = await fillSignAndPack(
      { sender: diamond.address, callData: proposeData },
      owner,
      entryPoint
    )
    op.signature = wrapSigMode0(op.signature)
    await (await entryPoint.handleOps([op], beneficiary.address)).wait()

    const proposal = await dao.getProposal(1)
    expect(proposal.description).to.equal('Execute Counter.increment via DAO+AA')

    // ------------------------------------------------------------
    // 10) Vote FOR via UserOp
    // ------------------------------------------------------------
    const voteData = dao.interface.encodeFunctionData('castVote', [1, 1])

    op = await fillSignAndPack(
      { sender: diamond.address, callData: voteData },
      owner,
      entryPoint
    )
    op.signature = wrapSigMode0(op.signature)
    await (await entryPoint.handleOps([op], beneficiary.address)).wait()

    // ------------------------------------------------------------
    // 11) Finalize via UserOp
    // ------------------------------------------------------------
    await ethers.provider.send('evm_increaseTime', [10])
    await ethers.provider.send('evm_mine', [])

    const finalizeData = dao.interface.encodeFunctionData('finalize', [1])

    op = await fillSignAndPack(
      { sender: diamond.address, callData: finalizeData },
      owner,
      entryPoint
    )
    op.signature = wrapSigMode0(op.signature)
    await (await entryPoint.handleOps([op], beneficiary.address)).wait()

    const st = await dao.state(1)
    expect(st).to.equal(2) // Succeeded

    // ------------------------------------------------------------
    // 12) Execute via UserOp (the real on-chain action)
    // ------------------------------------------------------------
    expect(await counter.number()).to.equal(0)

    const execData = dao.interface.encodeFunctionData('execute', [1])

    op = await fillSignAndPack(
      { sender: diamond.address, callData: execData },
      owner,
      entryPoint
    )
    op.signature = wrapSigMode0(op.signature)
    await (await entryPoint.handleOps([op], beneficiary.address)).wait()

    expect(await counter.number()).to.equal(1)
  })
})
