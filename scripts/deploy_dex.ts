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

  const Factory = await ethers.getContractFactory('SimpleV2Factory')
  const Router = await ethers.getContractFactory('SimpleV2Router')

  // read WETH from existing deployment written by deploy_tokens.ts
  const rootDeployDir = path.join(__dirname, '..', 'deployments')
  ensureDir(rootDeployDir)
  const rootFile = path.join(rootDeployDir, fileName)

  let deployment: any = {}
  if (fs.existsSync(rootFile)) {
    deployment = JSON.parse(fs.readFileSync(rootFile, 'utf8'))
  }

  const weth = deployment?.tokens?.WETH
  if (!weth) {
    throw new Error(`WETH not found in ${rootFile}. Please run deploy_tokens.ts first.`)
  }

  const dex1Factory = await Factory.deploy()
  await dex1Factory.deployed()
  console.log('DEX1Factory deployed to:', dex1Factory.address)

  const dex1Router = await Router.deploy(dex1Factory.address, weth)
  await dex1Router.deployed()
  console.log('DEX1Router deployed to:', dex1Router.address)

  const dex2Factory = await Factory.deploy()
  await dex2Factory.deployed()
  console.log('DEX2Factory deployed to:', dex2Factory.address)

  const dex2Router = await Router.deploy(dex2Factory.address, weth)
  await dex2Router.deployed()
  console.log('DEX2Router deployed to:', dex2Router.address)

  deployment.chainId = chainId
  deployment.dex = {
    ...(deployment.dex || {}),
    DEX1Factory: dex1Factory.address,
    DEX1Router: dex1Router.address,
    DEX2Factory: dex2Factory.address,
    DEX2Router: dex2Router.address,
  }

  fs.writeFileSync(rootFile, JSON.stringify(deployment, null, 2))

  const feDeployDir = path.join(__dirname, '..', 'frontend', 'public', 'deployments')
  ensureDir(feDeployDir)
  const feFile = path.join(feDeployDir, fileName)

  fs.writeFileSync(feFile, JSON.stringify(deployment, null, 2))

  console.log('DEX merged + synced.')
  console.log('root deployment :', rootFile)
  console.log('frontend deployment :', feFile)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})