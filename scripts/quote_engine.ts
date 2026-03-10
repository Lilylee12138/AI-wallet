import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'

type RouteQuote = {
  name: string
  path: string[]
  amountIn: string
  amountOut: string
  amountOutRaw: string
  effectiveRate: string
  priceImpactPct: string
  estimatedGas: number
  gasCostEth: string
  gasCostUsdApprox: string
  recommendedSlippagePct: string
  minimumReceived: string
  aiExplanation: string
}

function format4(n: number) {
  return n.toFixed(4)
}

function bnToNum18(bn: any) {
  return Number(ethers.utils.formatEther(bn))
}

function getAmountOut(amountIn: any, reserveIn: any, reserveOut: any) {
  const amountInWithFee = amountIn.mul(997)
  const numerator = amountInWithFee.mul(reserveOut)
  const denominator = reserveIn.mul(1000).add(amountInWithFee)
  return numerator.div(denominator)
}

function calcPriceImpactPct(amountInNum: number, reserveInNum: number) {
  if (reserveInNum <= 0) return 0
  return (amountInNum / reserveInNum) * 100
}

function recommendSlippagePct(priceImpactPct: number, hopCount: number) {
  const hopBuffer = hopCount === 1 ? 0.3 : 0.8
  const raw = priceImpactPct + hopBuffer
  if (raw < 0.5) return 0.5
  if (raw > 5) return 5
  return Number(raw.toFixed(2))
}

function minimumReceived(amountOutNum: number, slippagePct: number) {
  return amountOutNum * (1 - slippagePct / 100)
}

async function getPairMeta(pairAddr: string) {
  const pair = await ethers.getContractAt(
    [
      'function getReserves() view returns(uint112,uint112)',
      'function token0() view returns(address)',
      'function token1() view returns(address)'
    ],
    pairAddr
  )

  const [reserve0, reserve1] = await pair.getReserves()
  const token0 = await pair.token0()
  const token1 = await pair.token1()

  return {
    pair,
    reserve0,
    reserve1,
    token0: token0.toLowerCase(),
    token1: token1.toLowerCase()
  }
}

function mapReservesForInputToken(
  tokenIn: string,
  token0: string,
  reserve0: any,
  reserve1: any
) {
  if (tokenIn.toLowerCase() === token0.toLowerCase()) {
    return {
      reserveIn: reserve0,
      reserveOut: reserve1
    }
  } else {
    return {
      reserveIn: reserve1,
      reserveOut: reserve0
    }
  }
}

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  const deploymentPath = path.join(__dirname, '..', 'deployments', `${chainId}.json`)
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'))

  const GOV = deployment.tokens.GOV
  const USD = deployment.tokens.USD
  const WETH = deployment.tokens.WETH

  const pairDex1GovUsd = deployment.pools.DEX1_GOV_USD
  const pairDex1GovWeth = deployment.pools.DEX1_GOV_WETH
  const pairDex1WethUsd = deployment.pools.DEX1_WETH_USD
  const pairDex2GovUsd = deployment.pools.DEX2_GOV_USD

  // 你可以改这里测试不同输入量
  const amountIn = ethers.utils.parseEther('100')
  const amountInNum = bnToNum18(amountIn)

  // gas 配置（本地演示足够）
  const feeData = await ethers.provider.getFeeData()
  const gasPrice = feeData.gasPrice ?? ethers.utils.parseUnits('1.5', 'gwei')

  // 用池子的 WETH-USD 价格近似 1 ETH ≈ ? USD
  const wethUsdMeta = await getPairMeta(pairDex1WethUsd)
  const wethUsdReserves = mapReservesForInputToken(
    WETH,
    wethUsdMeta.token0,
    wethUsdMeta.reserve0,
    wethUsdMeta.reserve1
  )
  const ethPriceUsdApprox =
    bnToNum18(wethUsdReserves.reserveOut) / bnToNum18(wethUsdReserves.reserveIn)

  const quotes: RouteQuote[] = []

  // ---------------------------
  // Route 1: GOV -> USD (DEX1)
  // ---------------------------
  {
    const meta = await getPairMeta(pairDex1GovUsd)
    const { reserveIn, reserveOut } = mapReservesForInputToken(
      GOV,
      meta.token0,
      meta.reserve0,
      meta.reserve1
    )

    const out = getAmountOut(amountIn, reserveIn, reserveOut)

    const reserveInNum = bnToNum18(reserveIn)
    const outNum = bnToNum18(out)
    const impactPct = calcPriceImpactPct(amountInNum, reserveInNum)

    const estimatedGas = 90000
    const gasCostEth = bnToNum18(gasPrice.mul(estimatedGas))
    const gasCostUsdApprox = gasCostEth * ethPriceUsdApprox

    const slipPct = recommendSlippagePct(impactPct, 1)
    const minRecv = minimumReceived(outNum, slipPct)

    quotes.push({
      name: 'DEX1 direct GOV -> USD',
      path: ['GOV', 'USD'],
      amountIn: `${format4(amountInNum)} GOV`,
      amountOut: `${format4(outNum)} USD`,
      amountOutRaw: out.toString(),
      effectiveRate: `${format4(outNum / amountInNum)} USD / GOV`,
      priceImpactPct: `${format4(impactPct)}%`,
      estimatedGas,
      gasCostEth: `${format4(gasCostEth)} ETH`,
      gasCostUsdApprox: `${format4(gasCostUsdApprox)} USD`,
      recommendedSlippagePct: `${format4(slipPct)}%`,
      minimumReceived: `${format4(minRecv)} USD`,
      aiExplanation:
        impactPct > 3
          ? 'Direct route on DEX1, but price impact is relatively high for the current trade size.'
          : 'Direct route on DEX1 with simple execution and relatively low gas.'
    })
  }

  // ---------------------------
  // Route 2: GOV -> USD (DEX2)
  // ---------------------------
  {
    const meta = await getPairMeta(pairDex2GovUsd)
    const { reserveIn, reserveOut } = mapReservesForInputToken(
      GOV,
      meta.token0,
      meta.reserve0,
      meta.reserve1
    )

    const out = getAmountOut(amountIn, reserveIn, reserveOut)

    const reserveInNum = bnToNum18(reserveIn)
    const outNum = bnToNum18(out)
    const impactPct = calcPriceImpactPct(amountInNum, reserveInNum)

    const estimatedGas = 90000
    const gasCostEth = bnToNum18(gasPrice.mul(estimatedGas))
    const gasCostUsdApprox = gasCostEth * ethPriceUsdApprox

    const slipPct = recommendSlippagePct(impactPct, 1)
    const minRecv = minimumReceived(outNum, slipPct)

    quotes.push({
      name: 'DEX2 direct GOV -> USD',
      path: ['GOV', 'USD'],
      amountIn: `${format4(amountInNum)} GOV`,
      amountOut: `${format4(outNum)} USD`,
      amountOutRaw: out.toString(),
      effectiveRate: `${format4(outNum / amountInNum)} USD / GOV`,
      priceImpactPct: `${format4(impactPct)}%`,
      estimatedGas,
      gasCostEth: `${format4(gasCostEth)} ETH`,
      gasCostUsdApprox: `${format4(gasCostUsdApprox)} USD`,
      recommendedSlippagePct: `${format4(slipPct)}%`,
      minimumReceived: `${format4(minRecv)} USD`,
      aiExplanation:
        impactPct > 3
          ? 'Direct route on DEX2, but price impact is relatively high for the current trade size.'
          : 'Direct route on DEX2 with simple execution and relatively low gas.'
    })
  }

  // --------------------------------------
  // Route 3: GOV -> WETH -> USD (DEX1)
  // --------------------------------------
  {
    const metaGovWeth = await getPairMeta(pairDex1GovWeth)
    const metaWethUsd = await getPairMeta(pairDex1WethUsd)

    const firstHop = mapReservesForInputToken(
      GOV,
      metaGovWeth.token0,
      metaGovWeth.reserve0,
      metaGovWeth.reserve1
    )

    const outWeth = getAmountOut(amountIn, firstHop.reserveIn, firstHop.reserveOut)

    const secondHop = mapReservesForInputToken(
      WETH,
      metaWethUsd.token0,
      metaWethUsd.reserve0,
      metaWethUsd.reserve1
    )

    const outUsd = getAmountOut(outWeth, secondHop.reserveIn, secondHop.reserveOut)

    const reserveInNum = bnToNum18(firstHop.reserveIn)
    const outNum = bnToNum18(outUsd)
    const impactPctHop1 = calcPriceImpactPct(amountInNum, reserveInNum)
    const impactPctHop2 = calcPriceImpactPct(bnToNum18(outWeth), bnToNum18(secondHop.reserveIn))
    const totalImpactPct = impactPctHop1 + impactPctHop2

    const estimatedGas = 140000
    const gasCostEth = bnToNum18(gasPrice.mul(estimatedGas))
    const gasCostUsdApprox = gasCostEth * ethPriceUsdApprox

    const slipPct = recommendSlippagePct(totalImpactPct, 2)
    const minRecv = minimumReceived(outNum, slipPct)

    quotes.push({
      name: 'DEX1 multi-hop GOV -> WETH -> USD',
      path: ['GOV', 'WETH', 'USD'],
      amountIn: `${format4(amountInNum)} GOV`,
      amountOut: `${format4(outNum)} USD`,
      amountOutRaw: outUsd.toString(),
      effectiveRate: `${format4(outNum / amountInNum)} USD / GOV`,
      priceImpactPct: `${format4(totalImpactPct)}%`,
      estimatedGas,
      gasCostEth: `${format4(gasCostEth)} ETH`,
      gasCostUsdApprox: `${format4(gasCostUsdApprox)} USD`,
      recommendedSlippagePct: `${format4(slipPct)}%`,
      minimumReceived: `${format4(minRecv)} USD`,
      aiExplanation:
        'This route may offer better output through intermediate WETH liquidity, but it costs more gas because it uses two hops.'
    })
  }

  // 仅按 amountOut 排序
  const sortedByOutput = [...quotes].sort((a, b) => {
    return Number(b.amountOutRaw) - Number(a.amountOutRaw)
  })

  // 一个简单的综合评分：输出 - gas折算
  const scored = quotes.map((q) => {
    const outNum = Number(q.amountOut.split(' ')[0])
    const gasUsd = Number(q.gasCostUsdApprox.split(' ')[0])
    const score = outNum - gasUsd
    return {
      ...q,
      compositeScore: score
    }
  })

  const ranked = scored.sort((a, b) => b.compositeScore - a.compositeScore)
  const best = ranked[0]

  console.log('\n=== Swap Quote Engine ===\n')
  console.log(`Input: ${format4(amountInNum)} GOV\n`)

  console.log('--- Ranked Routes ---')
  for (const q of ranked) {
    console.log(`\nRoute: ${q.name}`)
    console.log(`Path: ${q.path.join(' -> ')}`)
    console.log(`Amount In: ${q.amountIn}`)
    console.log(`Expected Out: ${q.amountOut}`)
    console.log(`Effective Rate: ${q.effectiveRate}`)
    console.log(`Price Impact: ${q.priceImpactPct}`)
    console.log(`Estimated Gas: ${q.estimatedGas}`)
    console.log(`Gas Cost: ${q.gasCostEth} (~${q.gasCostUsdApprox})`)
    console.log(`Recommended Slippage: ${q.recommendedSlippagePct}`)
    console.log(`Minimum Received: ${q.minimumReceived}`)
    console.log(`AI Explanation: ${q.aiExplanation}`)
    console.log(`Composite Score: ${format4(q.compositeScore)}`)
  }

  console.log('\n--- Best Route ---')
  console.log(`Best: ${best.name}`)
  console.log(`Why: ${best.aiExplanation}`)

  console.log('\n--- Best Route JSON ---')
  console.log(
    JSON.stringify(
      {
        bestRoute: best.name,
        path: best.path,
        amountIn: best.amountIn,
        expectedOut: best.amountOut,
        effectiveRate: best.effectiveRate,
        priceImpact: best.priceImpactPct,
        estimatedGas: best.estimatedGas,
        recommendedSlippage: best.recommendedSlippagePct,
        minimumReceived: best.minimumReceived,
        aiExplanation: best.aiExplanation
      },
      null,
      2
    )
  )

  console.log('\n--- Output-only Ranking ---')
  for (const q of sortedByOutput) {
    console.log(`${q.name}: ${q.amountOut}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
