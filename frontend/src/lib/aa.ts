import { ethers } from 'ethers'

export type PackedUserOperation = {
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

const entryPointAbi = [
  'function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes) userOp) view returns (bytes32)',
  'function handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[] ops, address payable beneficiary)',
  //用来判断 UserOp 是否成功、失败原因是什么
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)',
]


const diamondAbi = [
  'function getNonce() view returns (uint256)'
]

export async function buildUserOp(params: {
  provider: ethers.providers.Web3Provider
  entryPoint: string
  diamond: string
  callData: string
}) {
  console.log('[aa] buildUserOp params', params)

  try {
    const { provider, entryPoint, diamond, callData } = params

    console.log('[aa] step1 check addresses')
    const entryPointAddr = ethers.utils.getAddress(entryPoint)
    const diamondAddr = ethers.utils.getAddress(diamond)

    console.log('[aa] step2 new Contract ep/da')
    const ep = new ethers.Contract(entryPointAddr, entryPointAbi, provider)
    const da = new ethers.Contract(diamondAddr, diamondAbi, provider)

    console.log('[aa] step3 da.getNonce()')
    const nonce = await da.getNonce()
    console.log('[aa] nonce', nonce.toString())

    console.log('[aa] step4 provider.getFeeData()')
    const feeData = await provider.getFeeData()
    console.log('[aa] feeData', feeData)

    console.log('[aa] step5 build userOp object')
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
      signature: '0x',
    }

    console.log('[aa] step6 ep.getUserOpHash(userOp)')
    console.log('[aa] ep.interface functions', Object.keys(ep.interface.functions).filter(k => k.includes('getUserOpHash')))
    console.log('[aa] getUserOpHash fragment', ep.interface.getFunction('getUserOpHash'))
    //const userOpHash: string = await ep.getUserOpHash(userOp)
    //把传对象改成传一个数组 tuple
    const userOpHash = await ep.getUserOpHash([
      userOp.sender,
      userOp.nonce,
      userOp.initCode,
      userOp.callData,
      userOp.accountGasLimits,
      userOp.preVerificationGas,
      userOp.gasFees,
      userOp.paymasterAndData,
      userOp.signature,
    ])

    console.log('[aa] step7 done', userOpHash)
    return { userOp, userOpHash }
  } catch (e: any) {
    console.error('[aa] buildUserOp ERROR', e)
    console.error('[aa] buildUserOp ERROR stack', e?.stack)
    throw e
  }
}




export async function signUserOpEOA(params: {
  provider: ethers.providers.Web3Provider
  userOpHash: string
}) {
  //console.log('[aa] signUserOpEOA params', params) //debug
  console.log('[aa] signUserOpEOA', params)//debug
  const { provider, userOpHash } = params
  const signer = provider.getSigner()

  // ValidationFacet 支持 EIP-191: toEthSignedMessageHash(userOpHash)
  const sig = await signer.signMessage(ethers.utils.arrayify(userOpHash))

  // mode = 0x00 + 65-byte signature
  return ethers.utils.hexConcat(['0x00', sig])
}

/*
export async function sendUserOp(params: {
  provider: ethers.providers.Web3Provider
  entryPoint: string
  beneficiary: string
  userOp: PackedUserOperation
}) {
  //console.log('[aa] sendUserOp params', params) //debug
  console.log('[aa] sendUserOp', params)//debug
  const { provider, entryPoint, beneficiary, userOp } = params
  const signer = provider.getSigner()
  const ep = new ethers.Contract(entryPoint, entryPointAbi, signer)

  const tx = await ep.handleOps([userOp], beneficiary)
  return tx.wait()
}*/

function tryDecodeErrorString(data: string): string {
  if (!data || data === '0x') return ''
  // Error(string) selector = 0x08c379a0
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

function decodeDaoCustomError(revertData: string): string {
  if (!revertData || revertData === '0x') return ''
  const daoIface = new ethers.utils.Interface([
    'error NotMember()',
    'error InvalidState()',
    'error VotingClosed()',
    'error AlreadyVoted()',
    'error AlreadyFinalized()',
    'error AlreadyExecuted()',
  ])
  try {
    const parsed = daoIface.parseError(revertData)
    return parsed?.name || ''
  } catch {
    return ''
  }
}


export async function sendUserOp(params: {
  provider: ethers.providers.Web3Provider
  entryPoint: string
  beneficiary: string
  userOp: PackedUserOperation
  userOpHash?: string
}) {
  console.log('[aa] sendUserOp params raw', params)

  const { provider, entryPoint, beneficiary, userOp, userOpHash } = params

  const entryPointAddr = ethers.utils.getAddress(entryPoint)
  const beneficiaryAddr = ethers.utils.getAddress(beneficiary)

  console.log('[aa] sendUserOp checked', { entryPointAddr, beneficiaryAddr })

  const signer = provider.getSigner()
  const ep = new ethers.Contract(entryPointAddr, entryPointAbi, signer)

  console.log('[aa] calling handleOps...')
  const opTuple = [
    userOp.sender,
    userOp.nonce,
    userOp.initCode,
    userOp.callData,
    userOp.accountGasLimits,
    userOp.preVerificationGas,
    userOp.gasFees,
    userOp.paymasterAndData,
    userOp.signature,
  ]

  const tx = await ep.handleOps([opTuple], beneficiaryAddr)
  console.log('[aa] handleOps tx hash', tx.hash)

  const receipt = await tx.wait()

  // 解析 EntryPoint 日志
  let success: boolean | undefined = undefined
  let revertData = ''

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== entryPointAddr.toLowerCase()) continue
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

  // 尽量把 revertData 解析成人话
  const daoErr = decodeDaoCustomError(revertData)
  const strErr = tryDecodeErrorString(revertData)
  const revertReason = daoErr || strErr || (revertData ? revertData : '')

  console.log('[aa] userOp result:', { success, revertReason })

  return { receipt, success, revertReason }
}