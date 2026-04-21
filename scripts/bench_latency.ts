import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'

type PackedUserOperation = {
  sender: string
  nonce: ethers.BigNumberish
  initCode: string
  callData: string
  accountGasLimits: string
  preVerificationGas: ethers.BigNumberish
  gasFees: string
  paymasterAndData: string
  signature: string
}

function loadDeployment() {
  const file = path.join(__dirname, '../deployments/31337.json')
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

function getOwnerIndex() {
  return Number(process.env.OWNER_INDEX ?? '0')
}

async function getOwnerSigner() {
  const signers = await ethers.getSigners()
  const ownerIndex = getOwnerIndex()
  const signer = signers[ownerIndex]

  if (!signer) {
    throw new Error(`Invalid OWNER_INDEX=${ownerIndex}, signers.length=${signers.length}`)
  }

  return signer
}

function packU128(high: ethers.BigNumberish, low: ethers.BigNumberish) {
  const hi = ethers.BigNumber.from(high).shl(128)
  const lo = ethers.BigNumber.from(low)
  return ethers.utils.hexZeroPad(hi.or(lo).toHexString(), 32)
}

const entryPointAbi = [
  'function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes) userOp) view returns (bytes32)',
  'function handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[] ops, address payable beneficiary)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)'
]

const diamondAbi = [
  'function getNonce() view returns (uint256)'
]

async function buildUserOp(params: {
  provider: typeof ethers.provider
  entryPoint: string
  diamond: string
  callData: string
}) {
  const { provider, entryPoint, diamond, callData } = params

  const entryPointAddr = ethers.utils.getAddress(entryPoint)
  const diamondAddr = ethers.utils.getAddress(diamond)

  const ep = new ethers.Contract(entryPointAddr, entryPointAbi, provider)
  const da = new ethers.Contract(diamondAddr, diamondAbi, provider)

  const nonce = await da.getNonce()
  const feeData = await provider.getFeeData()

  const verificationGasLimit = 500000
  const callGasLimit = 500000
  const preVerificationGas = 80000

  const maxFeePerGas =
    feeData.maxFeePerGas ?? ethers.utils.parseUnits('2', 'gwei')
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? ethers.utils.parseUnits('1', 'gwei')

  const userOp: PackedUserOperation = {
    sender: diamondAddr,
    nonce,
    initCode: '0x',
    callData,
    accountGasLimits: packU128(verificationGasLimit, callGasLimit),
    preVerificationGas,
    gasFees: packU128(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: '0x',
    signature: '0x'
  }

  const userOpHash = await ep.getUserOpHash([
    userOp.sender,
    userOp.nonce,
    userOp.initCode,
    userOp.callData,
    userOp.accountGasLimits,
    userOp.preVerificationGas,
    userOp.gasFees,
    userOp.paymasterAndData,
    userOp.signature
  ])

  return { userOp, userOpHash }
}

async function signUserOpEOA(params: {
  userOpHash: string
}) {
  const signer = await getOwnerSigner()
  const sig = await signer.signMessage(ethers.utils.arrayify(params.userOpHash))
  return ethers.utils.hexConcat(['0x00', sig])
}

function tryDecodeErrorString(data: string): string {
  if (!data || data === '0x') return ''

  if (data.startsWith('0x08c379a0')) {
    try {
      const reason = ethers.utils.defaultAbiCoder.decode(
        ['string'],
        '0x' + data.slice(10)
      )[0]
      return String(reason)
    } catch {}
  }

  return ''
}

async function sendUserOp(params: {
  entryPoint: string
  beneficiary: string
  userOp: PackedUserOperation
  userOpHash?: string
}) {
  const { entryPoint, beneficiary, userOp, userOpHash } = params

  const signer = await getOwnerSigner()
  const ep = new ethers.Contract(entryPoint, entryPointAbi, signer)

  const opTuple = [
    userOp.sender,
    userOp.nonce,
    userOp.initCode,
    userOp.callData,
    userOp.accountGasLimits,
    userOp.preVerificationGas,
    userOp.gasFees,
    userOp.paymasterAndData,
    userOp.signature
  ]

  const tx = await ep.handleOps([opTuple], beneficiary)
  const receipt = await tx.wait()

  let success: boolean | undefined = undefined
  let revertData = ''

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== entryPoint.toLowerCase()) continue

    try {
      const parsed = ep.interface.parseLog(log)

      if (parsed.name === 'UserOperationEvent') {
        const h = (parsed.args as any).userOpHash as string
        const ok = (parsed.args as any).success as boolean
        if (!userOpHash || h.toLowerCase() === userOpHash.toLowerCase()) {
          success = ok
        }
      }

      if (parsed.name === 'UserOperationRevertReason') {
        const h = (parsed.args as any).userOpHash as string
        const rr = (parsed.args as any).revertReason as string
        if (!userOpHash || h.toLowerCase() === userOpHash.toLowerCase()) {
          revertData = rr
        }
      }
    } catch {}
  }

  const revertReason = tryDecodeErrorString(revertData) || revertData || ''

  return { receipt, success, revertReason }
}

async function benchEOA(runs: number) {
  const signer = await getOwnerSigner()
  const recipient = '0x1000000000000000000000000000000000000002'
  const value = ethers.utils.parseEther('0.01')

  const results: number[] = []

  console.log('\n--- Benchmark EOA Latency ---')

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()

    const tx = await signer.sendTransaction({
      to: recipient,
      value
    })

    await tx.wait()

    const t1 = performance.now()
    const latency = t1 - t0

    results.push(latency)

    console.log(`EOA run ${i + 1}: latency = ${latency.toFixed(2)} ms`)
  }

  return results
}

async function benchAA(runs: number, entryPoint: string, diamond: string) {
  const provider = ethers.provider

  const iface = new ethers.utils.Interface([
    'function execute(address target,uint256 value,bytes data)'
  ])

  const recipient = '0x1000000000000000000000000000000000000002'
  const value = ethers.utils.parseEther('0.01')

  const results: number[] = []

  console.log('\n--- Benchmark Smart Account Latency ---')

  for (let i = 0; i < runs; i++) {
    const callData = iface.encodeFunctionData(
      'execute',
      [recipient, value, '0x']
    )

    const { userOp, userOpHash } = await buildUserOp({
      provider,
      entryPoint,
      diamond,
      callData
    })

    userOp.signature = await signUserOpEOA({
      userOpHash
    })

    const t0 = performance.now()

    const result = await sendUserOp({
      entryPoint,
      beneficiary: recipient,
      userOp,
      userOpHash
    })

    const t1 = performance.now()
    const latency = t1 - t0

    if (result.success === false) {
      throw new Error(`AA run ${i + 1} failed: ${result.revertReason || 'unknown revert'}`)
    }

    results.push(latency)

    console.log(`SmartAccount run ${i + 1}: latency = ${latency.toFixed(2)} ms`)
  }

  return results
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

  return avg
}

async function main() {
  const runs = 10
  const deployment = loadDeployment()

  const entryPoint = deployment.entryPoint
  const diamond = deployment.diamondAccount
  const ownerIndex = getOwnerIndex()
  const ownerSigner = await getOwnerSigner()

  if (!entryPoint || !diamond) {
    throw new Error('Missing entryPoint or diamondAccount in deployments/31337.json')
  }

  console.log('OWNER_INDEX:', ownerIndex)
  console.log('Owner signer:', ownerSigner.address)
  console.log('EntryPoint:', entryPoint)
  console.log('DiamondAccount:', diamond)

  const eoa = await benchEOA(runs)
  const aa = await benchAA(runs, entryPoint, diamond)

  const avgEOA = summarize('EOA', eoa)
  const avgAA = summarize('Smart Account', aa)

  console.log('\n===== Relative Latency =====')
  console.log('SmartAccount / EOA =', (avgAA / avgEOA).toFixed(2) + 'x')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})