import { ethers } from 'ethers'
import { buildIssuerMsgHash } from './aaSig'

export const signIssuerAuth = async (args: {
  issuer: ethers.Wallet
  diamond: string
  mode: number
  userOpHash: string
  sessionSigner: string
  validUntil: number
  scope: number
  sessionNonce: number
}): Promise<string> => {
  const msgHash = buildIssuerMsgHash({
    diamond: args.diamond,
    mode: args.mode,
    userOpHash: args.userOpHash,
    sessionSigner: args.sessionSigner,
    validUntil: args.validUntil,
    scope: args.scope,
    sessionNonce: args.sessionNonce
  })

  return args.issuer.signMessage(ethers.utils.arrayify(msgHash))
}
