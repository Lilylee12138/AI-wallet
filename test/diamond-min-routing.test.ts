import { expect } from 'chai'
import { ethers } from 'hardhat'

console.log('TEST FILE LOADED')

describe('Diamond minimal routing', function () {
  console.log('DESCRIBE RUN')
  it('routes hello() to HelloFacet via DiamondAccount fallback', async () => {
    console.log('IT RUN')
    const [deployer] = await ethers.getSigners()

    // Deploy DiamondAccount (proxy)
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(deployer.address)
    await diamond.deployed()
    const diamondAddr = diamond.address

    // Deploy HelloFacet
    const HelloFacet = await ethers.getContractFactory('HelloFacet')
    const facet = await HelloFacet.deploy()
    await facet.deployed()
    const facetAddr = facet.address

    // Compute selector for hello()
    const sel = ethers.utils.id('hello()').slice(0, 10) // 0x + 8 hex chars

    // Set routing: hello() selector => HelloFacet
    await (await diamond.setFacet(sel, facetAddr)).wait()

    // Call hello() on the DiamondAccount address, using HelloFacet ABI
    const helloViaDiamond = await ethers.getContractAt('HelloFacet', diamondAddr)
    const result = await helloViaDiamond.hello()

    expect(result).to.equal('hello from facet')
  })
})
