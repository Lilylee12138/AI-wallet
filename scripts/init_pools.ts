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

  // 1) Read deployment
  const rootDeployDir = path.join(__dirname, '..', 'deployments')
  ensureDir(rootDeployDir)
  const rootFile = path.join(rootDeployDir, fileName)

  if (!fs.existsSync(rootFile)) {
    throw new Error(`Deployment file not found: ${rootFile}`)
  }

  const deployment = JSON.parse(fs.readFileSync(rootFile, 'utf8'))

  if (!deployment.tokens) {
    throw new Error('deployment.tokens missing, run deploy_tokens.ts first')
  }

  if (
    !deployment.dex ||
    !deployment.dex.DEX1Factory ||
    !deployment.dex.DEX1Router ||
    !deployment.dex.DEX2Factory ||
    !deployment.dex.DEX2Router
  ) {
    throw new Error('deployment.dex missing required DEX1/DEX2 fields, run deploy_dex.ts first')
  }

  const GOV = deployment.tokens.GOV
  const USD = deployment.tokens.USD
  const WETH = deployment.tokens.WETH

  if (!GOV || !USD || !WETH) {
    throw new Error('tokens.GOV / tokens.USD / tokens.WETH missing in deployment')
  }

  const DEX1Factory = deployment.dex.DEX1Factory
  const DEX2Factory = deployment.dex.DEX2Factory

  console.log('tokens:', { GOV, USD, WETH })
  console.log('dex:', { DEX1Factory, DEX2Factory })

  // 2) Contract instances
  const dex1Factory = await ethers.getContractAt('SimpleV2Factory', DEX1Factory)
  const dex2Factory = await ethers.getContractAt('SimpleV2Factory', DEX2Factory)

  const gov = await ethers.getContractAt('MockERC20', GOV)
  const usd = await ethers.getContractAt('MockERC20', USD)
  const weth = await ethers.getContractAt('MockWETH', WETH)

  // 3) Prepare balances
  const govMintAmount = ethers.utils.parseUnits('2000000', 18)
  const usdMintAmount = ethers.utils.parseUnits('4000000', 18)
  const wethWrapAmount = ethers.utils.parseUnits('2000', 18)

  await (await gov.mint(deployer.address, govMintAmount)).wait()
  await (await usd.mint(deployer.address, usdMintAmount)).wait()
  await (await weth.deposit({ value: wethWrapAmount })).wait()

  console.log('Prepared token balances for liquidity')

  // 4) Ensure pair exists
  async function ensurePair(factory: any, tokenA: string, tokenB: string) {
    let pair = await factory.getPair(tokenA, tokenB)
    if (pair === ethers.constants.AddressZero) {
      const tx = await factory.createPair(tokenA, tokenB)
      await tx.wait()
      pair = await factory.getPair(tokenA, tokenB)
    }
    return pair
  }

  const pairDex1GovUsd = await ensurePair(dex1Factory, GOV, USD)
  const pairDex1GovWeth = await ensurePair(dex1Factory, GOV, WETH)
  const pairDex1WethUsd = await ensurePair(dex1Factory, WETH, USD)
  const pairDex2GovUsd = await ensurePair(dex2Factory, GOV, USD)

  console.log('pair DEX1 GOV-USD :', pairDex1GovUsd)
  console.log('pair DEX1 GOV-WETH:', pairDex1GovWeth)
  console.log('pair DEX1 WETH-USD:', pairDex1WethUsd)
  console.log('pair DEX2 GOV-USD :', pairDex2GovUsd)

  // 5) token addr -> contract helper
  function getTokenContract(addr: string) {
    if (addr.toLowerCase() === GOV.toLowerCase()) return gov
    if (addr.toLowerCase() === USD.toLowerCase()) return usd
    if (addr.toLowerCase() === WETH.toLowerCase()) return weth
    throw new Error(`Unknown token addr: ${addr}`)
  }

  // 6) Seed liquidity with approve + pair.addLiquidity(...)
  async function seedPair(
    pairAddr: string,
    tokenAAddr: string,
    tokenBAddr: string,
    amountA: any,
    amountB: any
  ) {
    const pair = await ethers.getContractAt('SimpleV2Pair', pairAddr)
    const token0 = await pair.token0()
    const token1 = await pair.token1()

    let amount0 = amountA
    let amount1 = amountB

    // reorder amounts to match pair.token0/token1
    if (
      token0.toLowerCase() === tokenBAddr.toLowerCase() &&
      token1.toLowerCase() === tokenAAddr.toLowerCase()
    ) {
      amount0 = amountB
      amount1 = amountA
    } else if (
      !(
        token0.toLowerCase() === tokenAAddr.toLowerCase() &&
        token1.toLowerCase() === tokenBAddr.toLowerCase()
      )
    ) {
      throw new Error(
        `Pair token mismatch: pair(${token0}, ${token1}) vs input(${tokenAAddr}, ${tokenBAddr})`
      )
    }

    const token0Ctr = getTokenContract(token0)
    const token1Ctr = getTokenContract(token1)

    await (await token0Ctr.approve(pairAddr, amount0)).wait()
    await (await token1Ctr.approve(pairAddr, amount1)).wait()

    await (await pair.addLiquidity(amount0, amount1)).wait()
  }

  // 7) Seed four pools
  // DEX1 GOV-USD
  await seedPair(
    pairDex1GovUsd,
    GOV,
    USD,
    ethers.utils.parseUnits('100000', 18),
    ethers.utils.parseUnits('280000', 18)
  )

  // DEX1 GOV-WETH
  await seedPair(
    pairDex1GovWeth,
    GOV,
    WETH,
    ethers.utils.parseUnits('100000', 18),
    ethers.utils.parseUnits('350', 18)
  )

  // DEX1 WETH-USD
  await seedPair(
    pairDex1WethUsd,
    WETH,
    USD,
    ethers.utils.parseUnits('500', 18),
    ethers.utils.parseUnits('1500000', 18)
  )

  // DEX2 GOV-USD
  await seedPair(
    pairDex2GovUsd,
    GOV,
    USD,
    ethers.utils.parseUnits('120000', 18),
    ethers.utils.parseUnits('330000', 18)
  )

  console.log('Liquidity seeded')

  // 8) Save pools
  deployment.pools = {
    ...(deployment.pools || {}),
    DEX1_GOV_USD: pairDex1GovUsd,
    DEX1_GOV_WETH: pairDex1GovWeth,
    DEX1_WETH_USD: pairDex1WethUsd,
    DEX2_GOV_USD: pairDex2GovUsd,
  }

  fs.writeFileSync(rootFile, JSON.stringify(deployment, null, 2))

  // 9) Sync frontend deployment
  const feDeployDir = path.join(__dirname, '..', 'frontend', 'public', 'deployments')
  ensureDir(feDeployDir)
  const feFile = path.join(feDeployDir, fileName)

  fs.writeFileSync(feFile, JSON.stringify(deployment, null, 2))

  console.log('Pools merged + synced.')
  console.log('root deployment :', rootFile)
  console.log('frontend deployment :', feFile)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
