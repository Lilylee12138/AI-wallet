import { ethers } from 'ethers'

export const buildIssuerMsgHash = (args: {
  diamond: string
  mode: number
  userOpHash: string
  sessionSigner: string
  validUntil: number
  scope: number
  sessionNonce: number
}): string => {
  const { diamond, mode, userOpHash, sessionSigner, validUntil, scope, sessionNonce } = args

  return ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ['string', 'address', 'uint8', 'bytes32', 'address', 'uint48', 'uint32', 'uint64'],
      ['AA_SESSION_AUTH_V1', diamond, mode, userOpHash, sessionSigner, validUntil, scope, sessionNonce]
    )
  )
}

// mode=0: 0x00 || ownerSig
export const wrapSigMode0 = (ownerSig: string): string => {
  return ethers.utils.hexConcat(['0x00', ownerSig])
}

// mode=1: 0x01 || abi.encode(credentialIdHash, sessionSigner, validUntil, scope, sessionNonce, issuerSig)
export const wrapSigMode1Passkey = (args: {
  credentialIdHash: string
  sessionSigner: string
  validUntil: number
  scope: number
  sessionNonce: number
  issuerSig: string
}): string => {
  const { credentialIdHash, sessionSigner, validUntil, scope, sessionNonce, issuerSig } = args

  const payload = ethers.utils.defaultAbiCoder.encode(
    ['bytes32', 'address', 'uint48', 'uint32', 'uint64', 'bytes'],
    [credentialIdHash, sessionSigner, validUntil, scope, sessionNonce, issuerSig]
  )

  return ethers.utils.hexConcat(['0x01', payload])
}

// mode=2: 0x02 || abi.encode(sessionSigner, validUntil, scope, sessionNonce, issuerSig)
export const wrapSigMode2OAuth = (args: {
  sessionSigner: string
  validUntil: number
  scope: number
  sessionNonce: number
  issuerSig: string
}): string => {
  const { sessionSigner, validUntil, scope, sessionNonce, issuerSig } = args

  const payload = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint48', 'uint32', 'uint64', 'bytes'],
    [sessionSigner, validUntil, scope, sessionNonce, issuerSig]
  )

  return ethers.utils.hexConcat(['0x02', payload])
}
