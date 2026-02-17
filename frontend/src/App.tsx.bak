import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { ethers } from 'ethers'

type Deployments = {
  chainId: number
  entryPoint: string
  diamond: string
  counter: string
  owner: string
}

const RPC_URL = 'http://127.0.0.1:8545'
const AUTH_URL = 'http://127.0.0.1:4010'

const ENTRYPOINT_ABI = [
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) op) view returns (bytes32)'
]

const EXEC_ABI = ['function execute(address,uint256,bytes)']
const COUNTER_ABI = ['function number() view returns (uint256)', 'function increment()']
const NONCE_ABI = ['function getNonce() view returns (uint256)']
const IDENTITY_ABI = [
  'function setTrustedIssuer(address)',
  'function getTrustedIssuer() view returns (address)',
  'function registerPasskey(bytes32,bytes32)',
  'function setSession(address,uint48,uint32,uint64)'
]

const pack128 = (hi: ethers.BigNumberish, lo: ethers.BigNumberish) =>
  ethers.utils.hexZeroPad(
    ethers.BigNumber.from(hi).shl(128).or(ethers.BigNumber.from(lo)).toHexString(),
    32
  )

const wrapSigMode0 = (sig: string) => ethers.utils.hexConcat(['0x00', sig])

const wrapSigMode1 = (args: {
  credentialIdHash: string
  sessionSigner: string
  validUntil: number
  scope: number
  sessionNonce: number
  issuerSig: string
}) => {
  const payload = ethers.utils.defaultAbiCoder.encode(
    ['bytes32', 'address', 'uint48', 'uint32', 'uint64', 'bytes'],
    [args.credentialIdHash, args.sessionSigner, args.validUntil, args.scope, args.sessionNonce, args.issuerSig]
  )
  return ethers.utils.hexConcat(['0x01', payload])
}

const wrapSigMode2 = (args: {
  sessionSigner: string
  validUntil: number
  scope: number
  sessionNonce: number
  issuerSig: string
}) => {
  const payload = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint48', 'uint32', 'uint64', 'bytes'],
    [args.sessionSigner, args.validUntil, args.scope, args.sessionNonce, args.issuerSig]
  )
  return ethers.utils.hexConcat(['0x02', payload])
}

export default function App () {
  const [dep, setDep] = useState<Deployments | null>(null)
  const [mode, setMode] = useState<'0' | '1' | '2'>('0')
  const [ownerPk, setOwnerPk] = useState('')
  const [counter, setCounter] = useState<string>('-')
  const [diamondBalance, setDiamondBalance] = useState<string>('-')
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const log = (s: string) => setLogs(l => [s, ...l].slice(0, 30))

  const provider = useMemo(() => new ethers.providers.JsonRpcProvider(RPC_URL), [])

  const owner = useMemo(() => {
    if (!ownerPk) return null
    try {
      return new ethers.Wallet(ownerPk, provider)
    } catch {
      return null
    }
  }, [ownerPk, provider])

  useEffect(() => {
    fetch('/deployments/local.json')
      .then(r => r.json())
      .then((d) => {
        setDep(d)
      })
      .catch((e) => log('failed to load deployments/local.json: ' + String(e?.message ?? e)))
  }, [])

  const refreshBalance = async () => {
    if (!dep) return
    const bal = await provider.getBalance(dep.diamond)
    setDiamondBalance(ethers.utils.formatEther(bal))
  }

  const readCounter = async () => {
    if (!dep) return
    const c = new ethers.Contract(dep.counter, COUNTER_ABI, provider)
    setCounter((await c.number()).toString())
  }

  useEffect(() => {
    void (async () => {
      if (!dep) return
      try {
        await refreshBalance()
        await readCounter()
      } catch {}
    })()
  }, [dep])

  const fundDiamond = async () => {
    if (!dep) return log('missing deployments')
    if (!owner) return log('paste owner private key')
    setBusy(true)
    try {
      const value = ethers.utils.parseEther('0.2')
      log('funding diamond 0.2 ETH...')
      await (await owner.sendTransaction({ to: dep.diamond, value })).wait()
      log('funded')
      await refreshBalance()
    } catch (e: any) {
      log('error: ' + String(e?.message ?? e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  const sendUserOp = async () => {
    if (!dep) return log('missing deployments')
    if (!owner) return log('paste owner private key')

    setBusy(true)
    try {
      const mustAddr: Array<[string, string]> = [
        ['entryPoint', dep.entryPoint],
        ['diamond', dep.diamond],
        ['counter', dep.counter]
      ]
      for (const [k, v] of mustAddr) {
        if (!v || !ethers.utils.isAddress(v)) {
          throw new Error('bad deployment ' + k + '=' + String(v))
        }
      }

      const bal = await provider.getBalance(dep.diamond)
      const minBal = ethers.utils.parseEther('0.05')
      if (bal.lt(minBal)) {
        log('diamond balance low, please fund wallet first')
        await refreshBalance()
        return
      }

      const entryPoint = new ethers.Contract(dep.entryPoint, ENTRYPOINT_ABI, owner)
      const nonceFacet = new ethers.Contract(dep.diamond, NONCE_ABI, owner)
      const identity = new ethers.Contract(dep.diamond, IDENTITY_ABI, owner)

      const nonce = await nonceFacet.getNonce()

      const incrementData = new ethers.utils.Interface(COUNTER_ABI).encodeFunctionData('increment', [])
      const callData = new ethers.utils.Interface(EXEC_ABI).encodeFunctionData('execute', [dep.counter, 0, incrementData])

      const fee = await provider.getFeeData()
      const maxFeePerGas = fee.maxFeePerGas ?? ethers.utils.parseUnits('2', 'gwei')
      const maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? ethers.utils.parseUnits('1', 'gwei')

      const op: any = {
        sender: dep.diamond,
        nonce,
        initCode: '0x',
        callData,
        accountGasLimits: pack128(1_000_000, 300_000),
        preVerificationGas: 50_000,
        gasFees: pack128(maxPriorityFeePerGas, maxFeePerGas),
        paymasterAndData: '0x',
        signature: '0x'
      }

      const userOpHash: string = await entryPoint.getUserOpHash(op)
      log('userOpHash=' + userOpHash)

      if (mode === '0') {
        const sig = await owner.signMessage(ethers.utils.arrayify(userOpHash))
        op.signature = wrapSigMode0(sig)
        log('mode=0 signed')
      } else {
        const health = await axios.get(AUTH_URL + '/health')
        const issuer = String(health.data?.issuer ?? '')
        if (!ethers.utils.isAddress(issuer)) throw new Error('bad issuer from auth service: ' + issuer)
        log('issuer=' + issuer)

        const currentIssuer = await identity.getTrustedIssuer()
        if (String(currentIssuer).toLowerCase() !== issuer.toLowerCase()) {
          await (await identity.setTrustedIssuer(issuer)).wait()
          log('setTrustedIssuer ok')
        }

        const block = await provider.getBlock('latest')
        const now = block?.timestamp ?? 0
        const validUntil = now + 3600
        const scope = 0
        const sessionNonce = 1
        const sessionSigner = ethers.Wallet.createRandom().address

        await (await identity.setSession(sessionSigner, validUntil, scope, 0)).wait()
        log('setSession ok')

        const issued = await axios.post(AUTH_URL + '/issue', {
          diamond: dep.diamond,
          mode: Number(mode),
          userOpHash,
          sessionSigner,
          validUntil,
          scope,
          sessionNonce
        })

        const issuerSig = String(issued.data?.issuerSig ?? '')
        if (!issuerSig || !issuerSig.startsWith('0x')) throw new Error('bad issuerSig from auth service')

        if (mode === '1') {
          const credentialIdHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('demo-passkey'))
          const rpIdHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('demo-rp'))
          await (await identity.registerPasskey(credentialIdHash, rpIdHash)).wait()
          log('registerPasskey ok')

          op.signature = wrapSigMode1({
            credentialIdHash,
            sessionSigner,
            validUntil,
            scope,
            sessionNonce,
            issuerSig
          })
          log('mode=1 authorized')
        } else {
          op.signature = wrapSigMode2({
            sessionSigner,
            validUntil,
            scope,
            sessionNonce,
            issuerSig
          })
          log('mode=2 authorized')
        }
      }

      const beneficiary = await owner.getAddress()
      log('handleOps beneficiary=' + beneficiary)

      await (await entryPoint.handleOps([op], beneficiary, { gasLimit: 8_000_000 })).wait()
      log('handleOps success')

      await readCounter()
      await refreshBalance()
    } catch (e: any) {
      log('error: ' + String(e?.message ?? e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  const lowBalance =
    diamondBalance !== '-' &&
    (() => {
      try {
        return ethers.utils.parseEther(diamondBalance).lt(ethers.utils.parseEther('0.05'))
      } catch {
        return false
      }
    })()

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h2>AA + Identity Wallet Demo</h2>

      <p>Counter: <b>{counter}</b></p>
      <button disabled={busy} onClick={() => { void readCounter() }}>Read Counter</button>

      <hr />

      <p>Diamond balance: <b>{diamondBalance}</b> ETH</p>
      <button disabled={busy} onClick={() => { void refreshBalance() }}>Refresh Balance</button>
      <button disabled={busy} style={{ marginLeft: 8 }} onClick={() => { void fundDiamond() }}>
        Fund Wallet (0.2 ETH)
      </button>

      {lowBalance ? (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid #ccc' }}>
          balance is low, please fund wallet before sending userOp
        </div>
      ) : null}

      <hr />

      <label>
        Mode:&nbsp;
        <select disabled={busy} value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value='0'>mode=0 EOA</option>
          <option value='1'>mode=1 Passkey</option>
          <option value='2'>mode=2 OAuth</option>
        </select>
      </label>

      <div style={{ marginTop: 12 }}>
        <input
          placeholder='Owner private key (Hardhat Account #1)'
          style={{ width: '100%', padding: 8 }}
          value={ownerPk}
          onChange={e => setOwnerPk(e.target.value.trim())}
        />
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
          demo uses owner private key to call owner-only IdentityFacet methods (setTrustedIssuer, setSession, registerPasskey)
        </div>
      </div>

      <button disabled={busy} style={{ marginTop: 12 }} onClick={() => { void sendUserOp() }}>
        Send UserOp
      </button>

      <ul style={{ marginTop: 14 }}>
        {logs.map((l, i) => (
          <li key={i} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {l}
          </li>
        ))}
      </ul>
    </div>
  )
}
