import http from 'http'
import { ethers } from 'ethers'

function readBody(req: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

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
  const oraclePk = process.env.ORACLE_PK
  if (!oraclePk) throw new Error('Missing ORACLE_PK')

  const chainId = Number(process.env.CHAIN_ID ?? '31337')
  const port = Number(process.env.RISK_PORT ?? '8787')

  const oracle = new ethers.Wallet(oraclePk)

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') {
        res.statusCode = 200
        res.end()
        return
      }

      if (req.method !== 'POST' || req.url !== '/risk') {
        res.statusCode = 404
        res.end('not found')
        return
      }

      const raw = await readBody(req)
      const body = JSON.parse(raw || '{}')

      const diamond = String(body.diamond || '')
      const userOpHash = String(body.userOpHash || '')
      const riskScoreBps = Number(body.riskScoreBps ?? 1200)

      if (!diamond || !ethers.utils.isAddress(diamond)) throw new Error('bad diamond')
      if (!userOpHash || !userOpHash.startsWith('0x') || userOpHash.length !== 66) throw new Error('bad userOpHash')
      if (riskScoreBps < 0 || riskScoreBps > 10000) throw new Error('bad riskScoreBps')

      const deadline = Math.floor(Date.now() / 1000) + 600

      const msgHash = buildMsgHash({ chainId, diamond, userOpHash, riskScoreBps, deadline })
      const oracleSig = await oracle.signMessage(ethers.utils.arrayify(msgHash))

      const out = {
        attestation: { userOpHash, riskScoreBps, deadline },
        oracleSig
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(out))
    } catch (e: any) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: e?.message || String(e) }))
    }
  })

  server.listen(port, () => {
    console.log('[risk] listening on', `http://localhost:${port}/risk`)
    console.log('[risk] oracle address =', oracle.address)
    console.log('[risk] chainId =', chainId)
  })
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
