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

const KEY = 'wallet_history'

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function appendHistory(item: HistoryItem) {
  const list = getHistory()

  list.unshift(item)

  // 只保留最近 20 条
  const trimmed = list.slice(0, 20)

  localStorage.setItem(KEY, JSON.stringify(trimmed))
}

export function clearHistory() {
  localStorage.removeItem(KEY)
}