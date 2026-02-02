import { expect } from 'chai'
import { ethers } from 'hardhat'
import { fillSignAndPack } from './UserOp'

describe('EntryPoint.handleOps -> DiamondAccount (Validation + Execution + Nonce)', function () {
  it('should validate and execute diamond.execute(counter.increment) via handleOps', async function () {
    const [deployer, owner, beneficiary] = await ethers.getSigners()

    // 1) Deploy EntryPoint (from contracts/core/EntryPoint.sol)
    const EntryPoint = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPoint.deploy()
    await entryPoint.deployed()

    // 2) Deploy Counter
    const Counter = await ethers.getContractFactory('Counter')
    const counter = await Counter.deploy()
    await counter.deployed()

    // 3) Deploy facets
    const ExecutionFacet = await ethers.getContractFactory('ExecutionFacet')
    const execFacet = await ExecutionFacet.deploy()
    await execFacet.deployed()

    const NonceFacet = await ethers.getContractFactory('NonceFacet')
    const nonceFacet = await NonceFacet.deploy()
    await nonceFacet.deployed()

    const ValidationFacet = await ethers.getContractFactory('ValidationFacet')
    const validationFacet = await ValidationFacet.deploy()
    await validationFacet.deployed()

    // 4) Deploy DiamondAccount (owner is EOA)
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    // Core invariant
    expect(await diamond.owner()).to.equal(owner.address)

    // 5) Set EntryPoint on diamond (so validateUserOp only accepts calls from EntryPoint)
    await (await diamond.connect(owner).setEntryPoint(entryPoint.address)).wait()

    // 6) Register selectors to facets
    const execSelector = execFacet.interface.getSighash('execute')
    await (await diamond.connect(owner).setFacet(execSelector, execFacet.address)).wait()

    const getNonceSelector = nonceFacet.interface.getSighash('getNonce')
    const useNonceSelector = nonceFacet.interface.getSighash('useNonce')
    await (await diamond.connect(owner).setFacet(getNonceSelector, nonceFacet.address)).wait()
    await (await diamond.connect(owner).setFacet(useNonceSelector, nonceFacet.address)).wait()

    const validateSelector = validationFacet.interface.getSighash('validateUserOp')
    await (await diamond.connect(owner).setFacet(validateSelector, validationFacet.address)).wait()

    // 7) Fund the account so it can pay missingAccountFunds if needed
    await (await deployer.sendTransaction({ to: diamond.address, value: ethers.utils.parseEther("1") })).wait()

    // 8) Build callData: diamond.execute(counter.increment)
    const diamondAsExec = ExecutionFacet.attach(diamond.address)
    const incrementData = counter.interface.encodeFunctionData('increment')
    const callData = diamondAsExec.interface.encodeFunctionData('execute', [counter.address, 0, incrementData])

    // 9) Build and sign userOp (helper will:
    // - fill nonce by calling diamond.getNonce()
    // - estimate callGasLimit
    // - sign EIP-712 with owner)
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

    // 10) Execute via EntryPoint.handleOps
    await (await entryPoint.handleOps([packedOp], beneficiary.address)).wait()

    // 11) Assert executed
    expect(await counter.number()).to.equal(1)
  })
})
