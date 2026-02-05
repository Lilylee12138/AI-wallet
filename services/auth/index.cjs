require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { ethers } = require('ethers')

const app = express()
app.use(cors())
app.use(express.json())

const pk = process.env.ISSUER_PRIVATE_KEY
if (!pk) throw new Error('missing ISSUER_PRIVATE_KEY')

const issuer = new ethers.Wallet(pk)

const buildIssuerMsgHash = (args) => {
  return ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ['string', 'address', 'uint8', 'bytes32', 'address', 'uint48', 'uint32', 'uint64'],
      ['AA_SESSION_AUTH_V1', args.diamond, args.mode, args.userOpHash, args.sessionSigner, args.validUntil, args.scope, args.sessionNonce]
    )
  )
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, issuer: issuer.address })
})

app.post('/issue', async (req, res) => {
  try {
    const { diamond, mode, userOpHash, sessionSigner, validUntil, scope, sessionNonce } = req.body

    const msgHash = buildIssuerMsgHash({
      diamond,
      mode: Number(mode),
      userOpHash,
      sessionSigner,
      validUntil: Number(validUntil),
      scope: Number(scope),
      sessionNonce: Number(sessionNonce)
    })

    const issuerSig = await issuer.signMessage(ethers.utils.arrayify(msgHash))
    res.json({ issuer: issuer.address, issuerSig })
  } catch (e) {
    res.status(400).json({ error: e?.message ?? String(e) })
  }
})

const port = Number(process.env.PORT ?? 4010)
app.listen(port, () => {
  console.log(`auth service listening on :${port}, issuer=${issuer.address}`)
})
