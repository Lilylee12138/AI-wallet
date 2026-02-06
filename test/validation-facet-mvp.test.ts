import { expect } from 'chai'
import { ethers } from 'hardhat'

describe.skip('DiamondAccount + ValidationFacet MVP (EOA sig)', function () {
  it('validateUserOp should accept owner signature when called by EntryPoint', async function () {
    const [owner, other] = await ethers.getSigners()

    // Deploy facet
    const ValidationFacet = await ethers.getContractFactory('ValidationFacet')
    const validationFacet = await ValidationFacet.deploy()
    await validationFacet.deployed()

    // Deploy diamond
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    // Deploy EntryPointCaller and set as entryPoint
    const EntryPointCaller = await ethers.getContractFactory('EntryPointCaller')
    const ep = await EntryPointCaller.deploy()
    await ep.deployed()

    await (await diamond.setEntryPoint(ep.address)).wait()

    // Register selector for validateUserOp
    const selector = validationFacet.interface.getSighash('validateUserOp')
    await (await diamond.setFacet(selector, validationFacet.address)).wait()

    // Attach ValidationFacet ABI to diamond
    const diamondAsValidation = ValidationFacet.attach(diamond.address)

    // Build a minimal userOp
    const userOp = {
      sender: diamond.address,
      nonce: 0,
      initCode: '0x',
      callData: '0x',
      callGasLimit: 0,
      verificationGasLimit: 0,
      preVerificationGas: 0,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      paymasterAndData: '0x',
      signature: '0x'
    }

    // Create a deterministic userOpHash for MVP test
    const userOpHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'bytes32'],
        [userOp.sender, userOp.nonce, ethers.utils.keccak256(userOp.callData)]
      )
    )

    // Owner signs EIP-191 digest (ethers.signMessage does that)
    const signature = await owner.signMessage(ethers.utils.arrayify(userOpHash))
    userOp.signature = signature

    // Call validate through EntryPointCaller (so msg.sender == entryPoint)
    const ret = await ep.callStatic.callValidate(diamond.address, userOp, userOpHash, 0)
    expect(ret).to.equal(0)

    // Now actually send tx and ensure nonce increments
    await (await ep.callValidate(diamond.address, userOp, userOpHash, 0)).wait()

    // Read nonce via NonceFacet (optional) or directly by calling Validation again with nonce mismatch
    // Here we just expect second call with same nonce to fail
    const ret2 = await ep.callStatic.callValidate(diamond.address, userOp, userOpHash, 0)
    expect(ret2).to.equal(1)

    // Wrong signer should fail
    const badSig = await other.signMessage(ethers.utils.arrayify(userOpHash))
    userOp.signature = badSig
    const ret3 = await ep.callStatic.callValidate(diamond.address, userOp, userOpHash, 0)
    expect(ret3).to.equal(1)

    // Direct call (not EntryPoint) should revert (enforceIsEntryPoint)
    await expect(diamondAsValidation.validateUserOp(userOp as any, userOpHash, 0)).to.be.reverted
  })
})