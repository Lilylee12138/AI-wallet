import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'

function loadDeployment() {
  const file = path.join(__dirname, '../deployments/31337.json')
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

function summarize(name: string, results: number[]) {
  const sum = results.reduce((a, b) => a + b, 0)
  const avg = sum / results.length
  const min = Math.min(...results)
  const max = Math.max(...results)

  console.log(`\n===== ${name} =====`)
  console.log('runs =', results.length)
  console.log('avg latency =', avg.toFixed(2), 'ms')
  console.log('min latency =', min.toFixed(2), 'ms')
  console.log('max latency =', max.toFixed(2), 'ms')

  return { avg, min, max }
}

async function buildUserOpHash(entryPoint: string, diamond: string) {
  const entryPointAbi = [
    'function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes) userOp) view returns (bytes32)'
  ]

  const diamondAbi = [
    'function getNonce() view returns (uint256)'
  ]

  const ep = new ethers.Contract(entryPoint, entryPointAbi, ethers.provider)
  const da = new ethers.Contract(diamond, diamondAbi, ethers.provider)

  const nonce = await da.getNonce()
  const feeData = await ethers.provider.getFeeData()

  const verificationGasLimit = 500000
  const callGasLimit = 500000
  const preVerificationGas = 80000

  const maxFeePerGas =
    feeData.maxFeePerGas ?? ethers.utils.parseUnits('2', 'gwei')
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? ethers.utils.parseUnits('1', 'gwei')

  const hi1 = ethers.BigNumber.from(verificationGasLimit).shl(128)
  const lo1 = ethers.BigNumber.from(callGasLimit)
  const accountGasLimits = ethers.utils.hexZeroPad(hi1.or(lo1).toHexString(), 32)

  const hi2 = ethers.BigNumber.from(maxPriorityFeePerGas).shl(128)
  const lo2 = ethers.BigNumber.from(maxFeePerGas)
  const gasFees = ethers.utils.hexZeroPad(hi2.or(lo2).toHexString(), 32)

  const iface = new ethers.utils.Interface([
    'function execute(address target,uint256 value,bytes data)'
  ])

  const recipient = '0x1000000000000000000000000000000000000002'
  const value = ethers.utils.parseEther('0.01')

  const callData = iface.encodeFunctionData(
    'execute',
    [recipient, value, '0x']
  )

  const userOp = [
    diamond,
    nonce,
    '0x',
    callData,
    accountGasLimits,
    preVerificationGas,
    gasFees,
    '0x',
    '0x'
  ]

  const userOpHash = await ep.getUserOpHash(userOp)

  return {
    userOpHash,
    gasGwei: ethers.utils.formatUnits(maxFeePerGas, 'gwei')
  }
}

async function main() {
  const runs = 10
  const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:8787'

  const deployment = loadDeployment()
  const entryPoint = deployment.entryPoint
  const diamond = deployment.diamondAccount

  if (!entryPoint || !diamond) {
    throw new Error('Missing entryPoint or diamondAccount in deployments/31337.json')
  }

  console.log('EntryPoint:', entryPoint)
  console.log('DiamondAccount:', diamond)
  console.log('API_BASE:', apiBase)

  const results: number[] = []

  for (let i = 0; i < runs; i++) {
    const { userOpHash, gasGwei } = await buildUserOpHash(entryPoint, diamond)

    const payload = {
      diamond,
      wallet: diamond,
      walletAddress: diamond,
      sender: diamond,
      account: diamond,
      recipient: '0x1000000000000000000000000000000000000002',
      to: '0x1000000000000000000000000000000000000002',
      valueEth: '0.01',
      value_eth: 0.01,
      amountEth: '0.01',
      userOpHash,
      user_op_hash: userOpHash,
      gasGwei: Number(gasGwei),
      gas_gwei: Number(gasGwei),
      chainId: 31337,
      chain_id: 31337
    }

    const t0 = performance.now()

    const res = await fetch(`${apiBase}/risk`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const t1 = performance.now()

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`/risk failed on run ${i + 1}: ${res.status} ${text}`)
    }

    const data = await res.json()
    const latency = t1 - t0

    results.push(latency)

    const score =
      data?.attestation?.riskScoreBps ??
      data?.riskScoreBps ??
      data?.scoreBps ??
      data?.risk_score_bps ??
      data?.riskScore ??
      'unknown'

    console.log(`Run ${i + 1}: latency = ${latency.toFixed(2)} ms, riskScoreBps = ${score}`)
  }

  summarize('AI Risk Detection Latency', results)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
