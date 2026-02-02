import { expect } from 'chai'
import { ethers } from 'hardhat'

describe('DiamondAccount + EntryPointDepositFacet', function () {
  it('should deposit to EntryPoint and withdraw back', async function () {
    const [deployer, owner, recipient] = await ethers.getSigners()

    // Deploy EntryPoint (contracts/core/EntryPoint.sol)
    const EntryPoint = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPoint.deploy()
    await entryPoint.deployed()

    // Deploy facet
    const EntryPointDepositFacet = await ethers.getContractFactory('EntryPointDepositFacet')
    const depositFacet = await EntryPointDepositFacet.deploy()
    await depositFacet.deployed()

    // Deploy diamond account (owner is owner signer)
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    // Core invariant
    expect(await diamond.owner()).to.equal(owner.address)

    // Set entryPoint on diamond (owner-only)
    await (await diamond.connect(owner).setEntryPoint(entryPoint.address)).wait()

    // Register facet selectors (owner-only)
    const depositSelector = depositFacet.interface.getSighash('depositToEntryPoint')
    const withdrawSelector = depositFacet.interface.getSighash('withdrawDepositTo')
    const getDepSelector = depositFacet.interface.getSighash('getEntryPointDeposit')

    await (await diamond.connect(owner).setFacet(depositSelector, depositFacet.address)).wait()
    await (await diamond.connect(owner).setFacet(withdrawSelector, depositFacet.address)).wait()
    await (await diamond.connect(owner).setFacet(getDepSelector, depositFacet.address)).wait()

    // Attach facet ABI to diamond address
    const diamondAsDeposit = EntryPointDepositFacet.attach(diamond.address)

    // Deposit 0.1 ETH from deployer (anyone can deposit)
    const amount = ethers.utils.parseEther('0.1')
    await (await diamondAsDeposit.connect(deployer).depositToEntryPoint({ value: amount })).wait()

    // Verify deposit increased on EntryPoint
    const dep1 = await entryPoint.balanceOf(diamond.address)
    expect(dep1).to.equal(amount)

    // Also verify via facet getter
    expect(await diamondAsDeposit.getEntryPointDeposit()).to.equal(amount)

    // Withdraw 0.06 ETH to recipient (owner-only)
    const withdrawAmount = ethers.utils.parseEther('0.06')
    const balBefore = await ethers.provider.getBalance(recipient.address)

    await (await diamondAsDeposit.connect(owner).withdrawDepositTo(recipient.address, withdrawAmount)).wait()

    const dep2 = await entryPoint.balanceOf(diamond.address)
    expect(dep2).to.equal(amount.sub(withdrawAmount))

    const balAfter = await ethers.provider.getBalance(recipient.address)
    expect(balAfter.sub(balBefore)).to.equal(withdrawAmount)

    // Non-owner withdraw should revert
    await expect(
      diamondAsDeposit.connect(deployer).withdrawDepositTo(recipient.address, 1)
    ).to.be.reverted
  })
})
