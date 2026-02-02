import { expect } from 'chai'
import { ethers } from 'hardhat'

describe('IdentityFacet', function () {
  it('can be registered via setFacet and called through Diamond', async function () {
    const [owner] = await ethers.getSigners()

    const Diamond = await ethers.getContractFactory('DiamondAccount')
    const diamond = await Diamond.deploy(owner.address)
    await diamond.deployed()

    const IdentityFacet = await ethers.getContractFactory('IdentityFacet')
    const identityFacet = await IdentityFacet.deploy()
    await identityFacet.deployed()

    const facetAddr = identityFacet.address
    const sel = (sig: string) => ethers.utils.id(sig).slice(0, 10)

    const selectors = [
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

    for (const s of selectors) {
      await (await diamond.connect(owner).setFacet(s, facetAddr)).wait()
    }

    const identity = await ethers.getContractAt('IdentityFacet', diamond.address, owner)

    const issuer = ethers.Wallet.createRandom().address
    await (await identity.setTrustedIssuer(issuer)).wait()
    expect(await identity.getTrustedIssuer()).to.equal(issuer)

    const cred = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('cred-1'))
    const rp = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('rpId-1'))
    await (await identity.registerPasskey(cred, rp)).wait()
    expect(await identity.isPasskeyEnabled(cred)).to.equal(true)

    const sessionSigner = ethers.Wallet.createRandom().address
    const block = await ethers.provider.getBlock('latest')
    const validUntil = (block?.timestamp ?? 0) + 3600

    await (await identity.setSession(sessionSigner, validUntil, 0, 0)).wait()
    const session = await identity.getSession(sessionSigner)
    expect(session.exists).to.equal(true)
  })
})
