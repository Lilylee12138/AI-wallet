import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

async function main() {
  const [deployer] = await ethers.getSigners()
  const network = await ethers.provider.getNetwork()
  const chainId = network.chainId
  const fileName = `${chainId}.json`

  console.log('Deployer:', deployer.address)
  console.log('chainId:', chainId)

  const MockERC20 = await ethers.getContractFactory('MockERC20')
  const MockWETH = await ethers.getContractFactory('MockWETH')

  // 1. Deploy GOV
  const gov = await MockERC20.deploy(
    'Governance Token',
    'GOV',
    18,
    deployer.address
  )
  await gov.deployed()
  console.log('GOV deployed to:', gov.address)

  // 2. Deploy USD
  const usd = await MockERC20.deploy(
    'Mock USD',
    'USD',
    18,
    deployer.address
  )
  await usd.deployed()
  console.log('USD deployed to:', usd.address)

  // 3. Deploy WETH
  const weth = await MockWETH.deploy()
  await weth.deployed()
  console.log('WETH deployed to:', weth.address)

  // 4. Mint initial GOV / USD to deployer
  const mintAmount = ethers.utils.parseUnits('1000000', 18)
  await (await gov.mint(deployer.address, mintAmount)).wait()
  await (await usd.mint(deployer.address, mintAmount)).wait()
  console.log('Minted GOV and USD to deployer:', deployer.address)

  // 5. Merge write root deployment
  const rootDeployDir = path.join(__dirname, '..', 'deployments')
  ensureDir(rootDeployDir)
  const rootFile = path.join(rootDeployDir, fileName)

  let deployment: any = {}
  if (fs.existsSync(rootFile)) {
    deployment = JSON.parse(fs.readFileSync(rootFile, 'utf8'))
  }

  deployment.chainId = chainId
  deployment.tokens = {
    ...(deployment.tokens || {}),
    GOV: gov.address,
    USD: usd.address,
    WETH: weth.address,
  }

  fs.writeFileSync(rootFile, JSON.stringify(deployment, null, 2))

  // 6. Sync to frontend
  const feDeployDir = path.join(__dirname, '..', 'frontend', 'public', 'deployments')
  ensureDir(feDeployDir)
  const feFile = path.join(feDeployDir, fileName)

  fs.writeFileSync(feFile, JSON.stringify(deployment, null, 2))

  console.log('Tokens merged + synced.')
  console.log('root deployment :', rootFile)
  console.log('frontend deployment :', feFile)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
