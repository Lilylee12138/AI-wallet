import { ethers } from 'ethers'

export function getInjectedProvider(): ethers.providers.Web3Provider {
  const w = window as any
  if (!w.ethereum) throw new Error('No injected wallet found (MetaMask)')
  return new ethers.providers.Web3Provider(w.ethereum)
}

export async function requestAccounts(p: ethers.providers.Web3Provider) {
  await p.send('eth_requestAccounts', [])
}

export async function getChainId(p: ethers.providers.Web3Provider): Promise<number> {
  const net = await p.getNetwork()
  return net.chainId
}
