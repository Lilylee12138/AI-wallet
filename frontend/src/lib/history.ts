export type HistoryItem = {
  id: string
  type: 'swap' | 'transfer'
  time: number
  tokenIn?: string
  tokenOut?: string
  amountIn?: string
  amountOut?: string
  to?: string
  txHash?: string
}

function makeKey(chainId: number | string, walletAddress: string) {
  return `wallet_history_${chainId}_${String(walletAddress).toLowerCase()}`
}

export function getHistory(chainId: number | string, walletAddress: string): HistoryItem[] {
  try {
    const raw = localStorage.getItem(makeKey(chainId, walletAddress))
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function appendHistory(
  chainId: number | string,
  walletAddress: string,
  item: HistoryItem
) {
  const list = getHistory(chainId, walletAddress)
  list.unshift(item)

  const trimmed = list.slice(0, 20)
  localStorage.setItem(makeKey(chainId, walletAddress), JSON.stringify(trimmed))
}

export function clearHistory(chainId: number | string, walletAddress: string) {
  localStorage.removeItem(makeKey(chainId, walletAddress))
}