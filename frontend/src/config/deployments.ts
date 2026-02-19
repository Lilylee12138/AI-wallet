export type Deployments = {
  chainId: number
  entryPoint: string
  diamondAccount: string
  counter: string
  owner: string
  facets?: Record<string, string>
}

async function fetchJson(path: string) {
  const res = await fetch(path, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${path}: ${text.slice(0, 80)}...`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 80)}...`)
  }
}

export async function loadDeployments(chainId: number): Promise<Deployments> {
  // Primary: match current chain
  try {
    return await fetchJson(`/deployments/${chainId}.json`)
  } catch (e) {
    // Dev fallback: use local hardhat deployments when user is on wrong network
    const fallback = 31337
    console.warn(`[deployments] fallback to ${fallback} because chainId=${chainId} missing`, e)
    return await fetchJson(`/deployments/${fallback}.json`)
  }
}
