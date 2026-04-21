import { ethers } from 'hardhat'
import fs from 'fs'
import path from 'path'

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

type RiskAttestation = {
  userOpHash: string
  riskScoreBps: number
  deadline: number
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

const depositFacetAbi = [
  'function getEntryPointDeposit() view returns (uint256)',
  'function depositToEntryPoint() payable'
]

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

async function ensurePrefund(diamond: string, minDepositEth = '0.05') {
  const signer = await getOwnerSigner()

  const depositAsDiamond = new ethers.Contract(
    diamond,
    depositFacetAbi,
    signer
  )

  const current = await depositAsDiamond.getEntryPointDeposit()
  const minDeposit = ethers.utils.parseEther(minDepositEth)

  console.log('[prefund] current deposit =', ethers.utils.formatEther(current), 'ETH')

  if (current.gte(minDeposit)) {
    console.log('[prefund] deposit is sufficient')
    return
  }

  const need = minDeposit.sub(current)

  console.log('[prefund] topping up =', ethers.utils.formatEther(need), 'ETH')

  const tx = await depositAsDiamond.depositToEntryPoint({
    value: need
  })

  await tx.wait()

  const updated = await depositAsDiamond.getEntryPointDeposit()
  console.log('[prefund] updated deposit =', ethers.utils.formatEther(updated), 'ETH')
}

async function ensureSmartAccountBalance(diamond: string, minBalanceEth = '0.20') {
  const signer = await getOwnerSigner()

  const current = await ethers.provider.getBalance(diamond)
  const minBalance = ethers.utils.parseEther(minBalanceEth)

  console.log('[balance] current smart account ETH =', ethers.utils.formatEther(current), 'ETH')

  if (current.gte(minBalance)) {
    console.log('[balance] smart account balance is sufficient')
    return
  }

  const need = minBalance.sub(current)

  console.log('[balance] topping up =', ethers.utils.formatEther(need), 'ETH')

  const tx = await signer.sendTransaction({
    to: diamond,
    value: need
  })

  await tx.wait()

  const updated = await ethers.provider.getBalance(diamond)
  console.log('[balance] updated smart account ETH =', ethers.utils.formatEther(updated), 'ETH')
}

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

  return { userOp, userOpHash, feeData }
}

async function signUserOpEOA_v2(params: {
  userOpHash: string
  attestation: RiskAttestation
  oracleSig: string
}) {
  const signer = await getOwnerSigner()
  const { userOpHash, attestation, oracleSig } = params

  const userSig = await signer.signMessage(ethers.utils.arrayify(userOpHash))

  const payload = ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'tuple(bytes32 userOpHash,uint16 riskScoreBps,uint48 deadline)', 'bytes'],
    [userSig, [attestation.userOpHash, attestation.riskScoreBps, attestation.deadline], oracleSig]
  )

  return ethers.utils.hexConcat(['0x00', payload])
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

function pickFirst<T>(...vals: T[]) {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

async function requestRiskAttestation(params: {
  apiBase: string
  wallet: string
  recipient: string
  valueEth: string
  userOpHash: string
  gasGwei: string
  chainId: number
}) {
  const { apiBase, wallet, recipient, valueEth, userOpHash, gasGwei, chainId } = params

  const payload = {
    diamond: wallet,
    wallet,
    walletAddress: wallet,
    sender: wallet,
    account: wallet,
    recipient,
    to: recipient,
    valueEth,
    value_eth: Number(valueEth),
    amountEth: valueEth,
    userOpHash,
    user_op_hash: userOpHash,
    gasGwei: Number(gasGwei),
    gas_gwei: Number(gasGwei),
    chainId,
    chain_id: chainId
  }

  const res = await fetch(`${apiBase}/risk`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`/risk failed: ${res.status} ${text}`)
  }

  const data = await res.json()

  const attestationUserOpHash = pickFirst(
    data?.attestation?.userOpHash,
    data?.userOpHash,
    data?.user_op_hash,
    userOpHash
  ) as string

  const riskScoreBpsRaw = pickFirst(
    data?.attestation?.riskScoreBps,
    data?.riskScoreBps,
    data?.scoreBps,
    data?.risk_score_bps,
    data?.riskScore
  )

  const deadlineRaw = pickFirst(
    data?.attestation?.deadline,
    data?.deadline,
    data?.expiresAt
  )

  const oracleSig = pickFirst(
    data?.oracleSig,
    data?.oracleSignature,
    data?.signature,
    data?.sig
  ) as string | undefined

  if (riskScoreBpsRaw === undefined) {
    throw new Error(`Missing riskScoreBps in /risk response: ${JSON.stringify(data)}`)
  }

  if (deadlineRaw === undefined) {
    throw new Error(`Missing deadline in /risk response: ${JSON.stringify(data)}`)
  }

  if (!oracleSig) {
    throw new Error(`Missing oracleSig in /risk response: ${JSON.stringify(data)}`)
  }

  const attestation: RiskAttestation = {
    userOpHash: attestationUserOpHash,
    riskScoreBps: Number(riskScoreBpsRaw),
    deadline: Number(deadlineRaw)
  }

  return {
    attestation,
    oracleSig,
    raw: data
  }
}

async function benchAI(runs: number, entryPoint: string, diamond: string, apiBase: string) {
  const provider = ethers.provider
  const network = await provider.getNetwork()

  const iface = new ethers.utils.Interface([
    'function execute(address target,uint256 value,bytes data)'
  ])

  const recipient = '0x1000000000000000000000000000000000000002'
  const value = ethers.utils.parseEther('0.01')
  const valueEth = '0.01'

  const results: number[] = []

  for (let i = 0; i < runs; i++) {
    const callData = iface.encodeFunctionData(
      'execute',
      [recipient, value, '0x']
    )

    const { userOp, userOpHash, feeData } = await buildUserOp({
      provider,
      entryPoint,
      diamond,
      callData
    })

    const gasGwei = ethers.utils.formatUnits(
      feeData.maxFeePerGas ?? ethers.utils.parseUnits('2', 'gwei'),
      'gwei'
    )

    const { attestation, oracleSig, raw } = await requestRiskAttestation({
      apiBase,
      wallet: diamond,
      recipient,
      valueEth,
      userOpHash,
      gasGwei,
      chainId: network.chainId
    })

    console.log(`AI run ${i + 1}: riskScoreBps = ${attestation.riskScoreBps}`)

    userOp.signature = await signUserOpEOA_v2({
      userOpHash,
      attestation,
      oracleSig
    })

    const result = await sendUserOp({
      entryPoint,
      beneficiary: recipient,
      userOp,
      userOpHash
    })

    if (result.success === false) {
      throw new Error(`AI run ${i + 1} failed: ${result.revertReason || JSON.stringify(raw)}`)
    }

    const gas = Number(result.receipt.gasUsed)
    results.push(gas)

    console.log(`AI run ${i + 1}: gasUsed = ${gas}`)
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
  console.log('avg gasUsed =', avg)
  console.log('min gasUsed =', min)
  console.log('max gasUsed =', max)

  return avg
}

async function main() {
  const runs = 10
  const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:8787'

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
  console.log('API_BASE:', apiBase)

  console.log('\n--- Ensure Smart Account Prefund ---')
  await ensurePrefund(diamond, '0.05')

  console.log('\n--- Ensure Smart Account Balance ---')
  await ensureSmartAccountBalance(diamond, '0.20')

  console.log('\n--- Benchmark AI Wallet ---')
  const ai = await benchAI(runs, entryPoint, diamond, apiBase)

  summarize('AI Wallet', ai)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})