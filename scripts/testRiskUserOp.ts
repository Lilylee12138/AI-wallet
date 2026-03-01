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

// pack two uint128 into one bytes32: (high << 128) | low
function packU128(high: ethers.BigNumberish, low: ethers.BigNumberish) {
  const hi = ethers.BigNumber.from(high).shl(128)
  const lo = ethers.BigNumber.from(low)
  return ethers.utils.hexZeroPad(hi.or(lo).toHexString(), 32)
}

// build msgHash exactly like LibRiskOracle.attestationMessageHash + RiskOracleFacet.checkRisk
function buildMsgHash(params: {
  chainId: number
  diamond: string
  userOpHash: string
  riskScoreBps: number
  deadline: number
}) {
  const prefix = ethers.utils.toUtf8Bytes('RISK_ATTEST_V1')
  const chainId32 = ethers.utils.hexZeroPad(ethers.utils.hexlify(params.chainId), 32)
  const addr20 = ethers.utils.arrayify(params.diamond)
  const userOpHash32 = ethers.utils.arrayify(params.userOpHash)
  const score2 = ethers.utils.zeroPad(ethers.utils.arrayify(ethers.utils.hexlify(params.riskScoreBps)), 2)
  const deadline6 = ethers.utils.zeroPad(ethers.utils.arrayify(ethers.utils.hexlify(params.deadline)), 6)

  const packed = ethers.utils.concat([prefix, chainId32, addr20, userOpHash32, score2, deadline6])
  return ethers.utils.keccak256(packed)
}

async function main() {
  const depPath = path.join(__dirname, '../frontend/public/deployments/31337.json')
  const dep = JSON.parse(fs.readFileSync(depPath, 'utf8'))

  const diamond = dep.diamondAccount as string
  const entryPointAddr = dep.entryPoint as string

  if (!diamond) throw new Error('deployments missing diamondAccount')
  if (!entryPointAddr) throw new Error('deployments missing entryPoint')

  console.log('deployment diamondAccount:', diamond)
  console.log('deployment entryPoint:', entryPointAddr)

  const provider = ethers.provider
  const net = await provider.getNetwork()
  const chainId = Number(net.chainId)

  const oraclePk = process.env.ORACLE_PK
  if (!oraclePk) throw new Error('Missing ORACLE_PK env var')

  const signers = await ethers.getSigners()
  const user = signers[1]

  const entryPointAbi = [
    'function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes) userOp) view returns (bytes32)',
    'function handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[] ops, address payable beneficiary)'
  ]

  const diamondAbi = ['function getNonce() view returns (uint256)']

  const ep = new ethers.Contract(entryPointAddr, entryPointAbi, user)
  const da = new ethers.Contract(diamond, diamondAbi, user)

  const nonce = await da.getNonce()
  console.log('diamond nonce:', nonce.toString())

  const execIface = new ethers.utils.Interface(['function execute(address to,uint256 value,bytes data)'])
  const recipient = signers[3].address
  const value = ethers.utils.parseEther('0.001')
  const callData = execIface.encodeFunctionData('execute', [recipient, value, '0x'])

  const verificationGasLimit = 500000
  const callGasLimit = 500000
  const preVerificationGas = 80000

  const maxFeePerGas = ethers.utils.parseUnits('2', 'gwei')
  const maxPriorityFeePerGas = ethers.utils.parseUnits('1', 'gwei')

  const userOp: PackedUserOperation = {
    sender: diamond,
    nonce,
    initCode: '0x',
    callData,
    accountGasLimits: packU128(verificationGasLimit, callGasLimit),
    preVerificationGas,
    gasFees: packU128(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: '0x',
    signature: '0x'
  }

  // IMPORTANT: like your aa.ts, pass tuple array to getUserOpHash
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

  // userSig: EOA signs userOpHash (EIP-191 personal_sign)
  const userSig = await user.signMessage(ethers.utils.arrayify(userOpHash))

  // attestation
  const deadline = Math.floor(Date.now() / 1000) + 600
  const riskScoreBps = Number(process.env.RISK_SCORE_BPS ?? '1200')

  // oracleSig
  const msgHash = buildMsgHash({ chainId, diamond, userOpHash, riskScoreBps, deadline })
  const oracleWallet = new ethers.Wallet(oraclePk, provider)
  const oracleSig = await oracleWallet.signMessage(ethers.utils.arrayify(msgHash))

  // signature v2: 0x00 || abi.encode(userSig, att, oracleSig)
  const payload = ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'tuple(bytes32 userOpHash,uint16 riskScoreBps,uint48 deadline)', 'bytes'],
    [userSig, [userOpHash, riskScoreBps, deadline], oracleSig]
  )
  userOp.signature = ethers.utils.hexConcat(['0x00', payload])

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

  console.log('recipient:', recipient)
  console.log('userOpHash:', userOpHash)
  console.log('riskScoreBps:', riskScoreBps)

  const tx = await ep.handleOps([opTuple], user.address)
  const rcpt = await tx.wait()
  console.log('handleOps tx:', rcpt.transactionHash)
  console.log('status:', rcpt.status)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
