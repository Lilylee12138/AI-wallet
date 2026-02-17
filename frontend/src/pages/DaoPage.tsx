import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { ethers } from 'ethers'
import DaoPanel from '../DaoPanel'

type Deployments = {
  chainId: number
  entryPoint: string
  diamond: string
  counter: string
  owner: string
  daoFacet?: string
}

const RPC_URL = 'http://127.0.0.1:8545'
const AUTH_URL = 'http://127.0.0.1:4010'

const ENTRYPOINT_ABI = [
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) op) view returns (bytes32)'
]

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

export default function DaoPage () {
  const [dep, setDep] = useState<Deployments | null>(null)
  const [mode, setMode] = useState<'0' | '1' | '2'>('0')
  const [ownerPk, setOwnerPk] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const log = useCallback((s: string) => {
    setLogs((l) => [s, ...l].slice(0, 40))
  }, [])

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
      .then((r) => r.json())
      .then((d: Deployments) => setDep(d))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        log('failed to load deployments/local.json: ' + msg)
      })
  }, [log])

  const buildAndSendUserOp = useCallback(async (callData: string) => {
    if (!dep) {
      log('missing deployments')
      return
    }
    if (!owner) {
      log('paste owner private key')
      return
    }

    setBusy(true)
    try {
      const entryPoint = new ethers.Contract(dep.entryPoint, ENTRYPOINT_ABI, owner)
      const nonceFacet = new ethers.Contract(dep.diamond, NONCE_ABI, owner)
      const identity = new ethers.Contract(dep.diamond, IDENTITY_ABI, owner)

      const nonce: ethers.BigNumber = await nonceFacet.getNonce()

      const fee = await provider.getFeeData()
      const maxFeePerGas = fee.maxFeePerGas ?? ethers.utils.parseUnits('2', 'gwei')
      const maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? ethers.utils.parseUnits('1', 'gwei')

      const op = {
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
        const issuer = String((health.data as { issuer?: string }).issuer ?? '')
        if (!ethers.utils.isAddress(issuer)) throw new Error('bad issuer from auth service: ' + issuer)
        log('issuer=' + issuer)

        const currentIssuer: string = await identity.getTrustedIssuer()
        if (String(currentIssuer).toLowerCase() !== issuer.toLowerCase()) {
          await (await identity.setTrustedIssuer(issuer)).wait()
          log('setTrustedIssuer ok')
        }

        const block = await provider.getBlock('latest')
        const now = block && typeof block.timestamp === 'number' ? block.timestamp : 0
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

        const issuerSig = String((issued.data as { issuerSig?: string }).issuerSig ?? '')
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log('error: ' + msg)
      throw e
    } finally {
      setBusy(false)
    }
  }, [dep, owner, provider, mode, log])

  return (
    <div>
      <h2>DAO Page</h2>

      <div style={{ marginBottom: 12 }}>
        <label>
          Mode:&nbsp;
          <select disabled={busy} value={mode} onChange={(e) => setMode(e.target.value as '0' | '1' | '2')}>
            <option value="0">mode=0 EOA</option>
            <option value="1">mode=1 Passkey</option>
            <option value="2">mode=2 OAuth</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Owner private key (Hardhat Account #1)"
          style={{ width: '100%', padding: 8 }}
          value={ownerPk}
          onChange={(e) => setOwnerPk(e.target.value.trim())}
        />
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
          demo uses owner private key to call owner-only IdentityFacet methods
        </div>
      </div>

      <DaoPanel
        dep={dep}
        provider={provider}
        busy={busy}
        log={log}
        buildAndSendUserOp={buildAndSendUserOp}
      />

      <div style={{ marginTop: 16 }}>
        <h3>Logs</h3>
        <ul>
          {logs.map((l, i) => (
            <li key={i} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
