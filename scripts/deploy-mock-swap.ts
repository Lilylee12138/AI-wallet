import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'

function readJson(p: string) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
function writeJson(p: string, v: any) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(v, null, 2))
}

async function main() {
  const net = await ethers.provider.getNetwork()
  const chainId = Number(net.chainId)

  const Router = await ethers.getContractFactory('MockSwapRouter')
  const router = await Router.deploy()
  await router.deployed()

  console.log('MockSwapRouter:', router.address)

  // update deployments json (both backend + frontend public)
  const root = process.cwd()
  const backPath = path.join(root, 'deployments', `${chainId}.json`)
  const frontPath = path.join(root, 'frontend', 'public', 'deployments', `${chainId}.json`)

  const base = fs.existsSync(backPath) ? readJson(backPath) : { chainId }
  const next = { ...base, mockSwapRouter: router.address }

  writeJson(backPath, next)
  writeJson(frontPath, next)

  console.log('Updated:', backPath)
  console.log('Updated:', frontPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
