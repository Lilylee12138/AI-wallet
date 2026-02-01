import { expect } from 'chai'
import * as hre from 'hardhat'
const ethers = (hre as any).ethers

describe('DiamondAccount + ExecutionFacet', function () {
  it('diamond.execute() should call Counter.increment()', async function () {
    const [owner] = await ethers.getSigners()

    // Deploy Counter
    const Counter = await ethers.getContractFactory('Counter')
    const counter = await Counter.deploy()
    await counter.deployed()

    // Deploy ExecutionFacet
    const ExecutionFacet = await ethers.getContractFactory('ExecutionFacet')
    const execFacet = await ExecutionFacet.deploy()
    await execFacet.deployed()

    // Deploy DiamondAccount
    const DiamondAccount = await ethers.getContractFactory('DiamondAccount')
    const diamond = await DiamondAccount.deploy(owner.address)
    await diamond.deployed()

    // Register selector for execute(address,uint256,bytes)
    const executeSelector = execFacet.interface.getSighash('execute')
    await (await diamond.setFacet(executeSelector, execFacet.address)).wait()

    // Call diamond via ExecutionFacet ABI (IMPORTANT)
    const diamondAsExec = ExecutionFacet.attach(diamond.address)

    // Encode Counter.increment()
    const incrementData = counter.interface.encodeFunctionData('increment')

    // Execute via diamond
    await (await diamondAsExec.execute(counter.address, 0, incrementData)).wait()

    expect(await counter.number()).to.equal(1)
  })
})
