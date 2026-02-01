import { expect } from 'chai'
import { ethers } from 'hardhat'

describe('DiamondAccount + NonceFacet', function () {
  it('getNonce() starts at 0 and increments via useNonce()', async function () {
    const [owner, other] = await ethers.getSigners()

    // Deploy NonceFacet
    const NonceFacet = await ethers.getContractFactory('NonceFacet')
    const nonceFacet = await NonceFacet.deploy()
    await nonceFacet.deployed()

    // Deploy DiamondAccount
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    // Register selectors for getNonce() and useNonce()
    const getNonceSelector = nonceFacet.interface.getSighash('getNonce')
    const useNonceSelector = nonceFacet.interface.getSighash('useNonce')

    await (await diamond.setFacet(getNonceSelector, nonceFacet.address)).wait()
    await (await diamond.setFacet(useNonceSelector, nonceFacet.address)).wait()

    // Call diamond using NonceFacet ABI (IMPORTANT)
    const diamondAsNonce = NonceFacet.attach(diamond.address)

    // Initial nonce = 0
    expect(await diamondAsNonce.getNonce()).to.equal(0)

    // Owner increments nonce
    await (await diamondAsNonce.useNonce()).wait()
    expect(await diamondAsNonce.getNonce()).to.equal(1)

    // Non-owner should revert
    await expect(diamondAsNonce.connect(other).useNonce()).to.be.reverted
  })
})
