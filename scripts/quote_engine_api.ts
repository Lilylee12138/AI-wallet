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
  compositeScore: number
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
    return { reserveIn: reserve0, reserveOut: reserve1 }
  } else {
    return { reserveIn: reserve1, reserveOut: reserve0 }
  }
}

type PairContext = {
  GOV: string
  USD: string
  WETH: string
  pairDex1GovUsd: string
  pairDex1GovWeth: string
  pairDex1WethUsd: string
  pairDex2GovUsd: string
  gasPrice: any
  ethPriceUsdApprox: number
  amountIn: any
  amountInNum: number
}

async function quoteSingleHop(
  name: string,
  tokenInSymbol: string,
  tokenOutSymbol: string,
  tokenInAddr: string,
  pairAddr: string,
  estimatedGas: number,
  ctx: PairContext
): Promise<RouteQuote> {
  const meta = await getPairMeta(pairAddr)
  const { reserveIn, reserveOut } = mapReservesForInputToken(
    tokenInAddr,
    meta.token0,
    meta.reserve0,
    meta.reserve1
  )

  const out = getAmountOut(ctx.amountIn, reserveIn, reserveOut)
  const reserveInNum = bnToNum18(reserveIn)
  const outNum = bnToNum18(out)
  const impactPct = calcPriceImpactPct(ctx.amountInNum, reserveInNum)

  const gasCostEth = bnToNum18(ctx.gasPrice.mul(estimatedGas))
  const gasCostUsdApprox = gasCostEth * ctx.ethPriceUsdApprox
  const slipPct = recommendSlippagePct(impactPct, 1)
  const minRecv = minimumReceived(outNum, slipPct)

  return {
    name,
    path: [tokenInSymbol, tokenOutSymbol],
    amountIn: `${format4(ctx.amountInNum)} ${tokenInSymbol}`,
    amountOut: `${format4(outNum)} ${tokenOutSymbol}`,
    amountOutRaw: out.toString(),
    effectiveRate: `${format4(outNum / ctx.amountInNum)} ${tokenOutSymbol} / ${tokenInSymbol}`,
    priceImpactPct: `${format4(impactPct)}%`,
    estimatedGas,
    gasCostEth: `${format4(gasCostEth)} ETH`,
    gasCostUsdApprox: `${format4(gasCostUsdApprox)} USD`,
    recommendedSlippagePct: `${format4(slipPct)}%`,
    minimumReceived: `${format4(minRecv)} ${tokenOutSymbol}`,
    aiExplanation:
      impactPct > 3
        ? `Direct route on ${name}, but price impact is relatively high for the current trade size.`
        : `Direct route on ${name} with simple execution and relatively low gas.`,
    compositeScore: outNum - gasCostUsdApprox
  }
}

async function quoteTwoHop(
  name: string,
  tokenInSymbol: string,
  midSymbol: string,
  tokenOutSymbol: string,
  tokenInAddr: string,
  midAddr: string,
  firstPairAddr: string,
  secondPairAddr: string,
  estimatedGas: number,
  ctx: PairContext
): Promise<RouteQuote> {
  const meta1 = await getPairMeta(firstPairAddr)
  const meta2 = await getPairMeta(secondPairAddr)

  const firstHop = mapReservesForInputToken(
    tokenInAddr,
    meta1.token0,
    meta1.reserve0,
    meta1.reserve1
  )
  const outMid = getAmountOut(ctx.amountIn, firstHop.reserveIn, firstHop.reserveOut)

  const secondHop = mapReservesForInputToken(
    midAddr,
    meta2.token0,
    meta2.reserve0,
    meta2.reserve1
  )
  const outFinal = getAmountOut(outMid, secondHop.reserveIn, secondHop.reserveOut)

  const impactPctHop1 = calcPriceImpactPct(ctx.amountInNum, bnToNum18(firstHop.reserveIn))
  const impactPctHop2 = calcPriceImpactPct(bnToNum18(outMid), bnToNum18(secondHop.reserveIn))
  const totalImpactPct = impactPctHop1 + impactPctHop2
  const outNum = bnToNum18(outFinal)

  const gasCostEth = bnToNum18(ctx.gasPrice.mul(estimatedGas))
  const gasCostUsdApprox = gasCostEth * ctx.ethPriceUsdApprox
  const slipPct = recommendSlippagePct(totalImpactPct, 2)
  const minRecv = minimumReceived(outNum, slipPct)

  return {
    name,
    path: [tokenInSymbol, midSymbol, tokenOutSymbol],
    amountIn: `${format4(ctx.amountInNum)} ${tokenInSymbol}`,
    amountOut: `${format4(outNum)} ${tokenOutSymbol}`,
    amountOutRaw: outFinal.toString(),
    effectiveRate: `${format4(outNum / ctx.amountInNum)} ${tokenOutSymbol} / ${tokenInSymbol}`,
    priceImpactPct: `${format4(totalImpactPct)}%`,
    estimatedGas,
    gasCostEth: `${format4(gasCostEth)} ETH`,
    gasCostUsdApprox: `${format4(gasCostUsdApprox)} USD`,
    recommendedSlippagePct: `${format4(slipPct)}%`,
    minimumReceived: `${format4(minRecv)} ${tokenOutSymbol}`,
    aiExplanation:
      `This route may offer better output through intermediate ${midSymbol} liquidity, but it costs more gas because it uses two hops.`,
    compositeScore: outNum - gasCostUsdApprox
  }
}

async function buildQuotes(tokenIn: string, tokenOut: string, ctx: PairContext): Promise<RouteQuote[]> {
  const { GOV, USD, WETH } = ctx
  const quotes: RouteQuote[] = []

  // ETH is normalized to WETH inside the engine
  const normIn = tokenIn === 'ETH' ? 'WETH' : tokenIn
  const normOut = tokenOut === 'ETH' ? 'WETH' : tokenOut

  // GOV -> USD
  if (normIn === 'GOV' && normOut === 'USD') {
    quotes.push(
      await quoteSingleHop('DEX1 direct GOV -> USD', 'GOV', 'USD', GOV, ctx.pairDex1GovUsd, 90000, ctx)
    )
    quotes.push(
      await quoteSingleHop('DEX2 direct GOV -> USD', 'GOV', 'USD', GOV, ctx.pairDex2GovUsd, 90000, ctx)
    )
    quotes.push(
      await quoteTwoHop(
        'DEX1 multi-hop GOV -> WETH -> USD',
        'GOV',
        'WETH',
        'USD',
        GOV,
        WETH,
        ctx.pairDex1GovWeth,
        ctx.pairDex1WethUsd,
        140000,
        ctx
      )
    )
  }

  // USD -> GOV
  else if (normIn === 'USD' && normOut === 'GOV') {
    quotes.push(
      await quoteSingleHop('DEX1 direct USD -> GOV', 'USD', 'GOV', USD, ctx.pairDex1GovUsd, 90000, ctx)
    )
    quotes.push(
      await quoteSingleHop('DEX2 direct USD -> GOV', 'USD', 'GOV', USD, ctx.pairDex2GovUsd, 90000, ctx)
    )
    quotes.push(
      await quoteTwoHop(
        'DEX1 multi-hop USD -> WETH -> GOV',
        'USD',
        'WETH',
        'GOV',
        USD,
        WETH,
        ctx.pairDex1WethUsd,
        ctx.pairDex1GovWeth,
        140000,
        ctx
      )
    )
  }

  // ETH/WETH -> GOV
  else if (normIn === 'WETH' && normOut === 'GOV') {
    quotes.push(
      await quoteSingleHop('DEX1 direct WETH -> GOV', 'ETH', 'GOV', WETH, ctx.pairDex1GovWeth, 95000, ctx)
    )
  }

  // GOV -> ETH/WETH
  else if (normIn === 'GOV' && normOut === 'WETH') {
    quotes.push(
      await quoteSingleHop('DEX1 direct GOV -> WETH', 'GOV', 'ETH', GOV, ctx.pairDex1GovWeth, 95000, ctx)
    )
  }

  // ETH/WETH -> USD
  else if (normIn === 'WETH' && normOut === 'USD') {
    quotes.push(
      await quoteSingleHop('DEX1 direct WETH -> USD', 'ETH', 'USD', WETH, ctx.pairDex1WethUsd, 95000, ctx)
    )
    quotes.push(
      await quoteTwoHop(
        'DEX1 multi-hop WETH -> GOV -> USD',
        'ETH',
        'GOV',
        'USD',
        WETH,
        GOV,
        ctx.pairDex1GovWeth,
        ctx.pairDex1GovUsd,
        140000,
        ctx
      )
    )
    quotes.push(
      await quoteTwoHop(
        'DEX2-assisted WETH -> GOV -> USD',
        'ETH',
        'GOV',
        'USD',
        WETH,
        GOV,
        ctx.pairDex1GovWeth,
        ctx.pairDex2GovUsd,
        140000,
        ctx
      )
    )
  }

  // USD -> ETH/WETH
  else if (normIn === 'USD' && normOut === 'WETH') {
    quotes.push(
      await quoteSingleHop('DEX1 direct USD -> WETH', 'USD', 'ETH', USD, ctx.pairDex1WethUsd, 95000, ctx)
    )
    quotes.push(
      await quoteTwoHop(
        'DEX1 multi-hop USD -> GOV -> WETH',
        'USD',
        'GOV',
        'ETH',
        USD,
        GOV,
        ctx.pairDex1GovUsd,
        ctx.pairDex1GovWeth,
        140000,
        ctx
      )
    )
    quotes.push(
      await quoteTwoHop(
        'DEX2-assisted USD -> GOV -> WETH',
        'USD',
        'GOV',
        'ETH',
        USD,
        GOV,
        ctx.pairDex2GovUsd,
        ctx.pairDex1GovWeth,
        140000,
        ctx
      )
    )
  }

  else {
    throw new Error(`Unsupported token pair: ${tokenIn} -> ${tokenOut}`)
  }

  return quotes
}

async function main() {
  const amountArg = process.env.AMOUNT_IN
  const tokenInArg = (process.env.TOKEN_IN || '').toUpperCase()
  const tokenOutArg = (process.env.TOKEN_OUT || '').toUpperCase()

  if (!amountArg) {
    throw new Error('Usage: TOKEN_IN=ETH TOKEN_OUT=GOV AMOUNT_IN=0.1 npx hardhat run scripts/quote_engine_api.ts --network localhost')
  }
  if (!tokenInArg || !tokenOutArg) {
    throw new Error('TOKEN_IN and TOKEN_OUT are required')
  }

  const amountInHuman = Number(amountArg)
  if (!Number.isFinite(amountInHuman) || amountInHuman <= 0) {
    throw new Error(`Invalid amountIn: ${amountArg}`)
  }

  const chainId = (await ethers.provider.getNetwork()).chainId
  const deploymentPath = path.join(__dirname, '..', 'deployments', `${chainId}.json`)
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`)
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'))

  const GOV = deployment.tokens.GOV
  const USD = deployment.tokens.USD
  const WETH = deployment.tokens.WETH

  const pairDex1GovUsd = deployment.pools.DEX1_GOV_USD
  const pairDex1GovWeth = deployment.pools.DEX1_GOV_WETH
  const pairDex1WethUsd = deployment.pools.DEX1_WETH_USD
  const pairDex2GovUsd = deployment.pools.DEX2_GOV_USD

  const amountIn = ethers.utils.parseEther(String(amountInHuman))
  const amountInNum = bnToNum18(amountIn)

  const feeData = await ethers.provider.getFeeData()
  const gasPrice = feeData.gasPrice ?? ethers.utils.parseUnits('1.5', 'gwei')

  const wethUsdMeta = await getPairMeta(pairDex1WethUsd)
  const wethUsdReserves = mapReservesForInputToken(
    WETH,
    wethUsdMeta.token0,
    wethUsdMeta.reserve0,
    wethUsdMeta.reserve1
  )
  const ethPriceUsdApprox =
    bnToNum18(wethUsdReserves.reserveOut) / bnToNum18(wethUsdReserves.reserveIn)

  const ctx: PairContext = {
    GOV,
    USD,
    WETH,
    pairDex1GovUsd,
    pairDex1GovWeth,
    pairDex1WethUsd,
    pairDex2GovUsd,
    gasPrice,
    ethPriceUsdApprox,
    amountIn,
    amountInNum
  }

  const quotes = await buildQuotes(tokenInArg, tokenOutArg, ctx)
  const ranked = [...quotes].sort((a, b) => b.compositeScore - a.compositeScore)
  const best = ranked[0]

  const result = {
    input: {
      tokenIn: tokenInArg,
      tokenOut: tokenOutArg,
      amountIn: amountInHuman
    },
    routes: ranked,
    bestRoute: {
      name: best.name,
      path: best.path,
      amountIn: best.amountIn,
      expectedOut: best.amountOut,
      amountOutRaw: best.amountOutRaw,
      effectiveRate: best.effectiveRate,
      priceImpact: best.priceImpactPct,
      estimatedGas: best.estimatedGas,
      gasCostEth: best.gasCostEth,
      gasCostUsdApprox: best.gasCostUsdApprox,
      recommendedSlippage: best.recommendedSlippagePct,
      minimumReceived: best.minimumReceived,
      aiExplanation: best.aiExplanation
    }
  }

  console.log(JSON.stringify(result))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
