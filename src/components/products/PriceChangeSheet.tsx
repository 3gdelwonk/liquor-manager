import { useState } from 'react'
import { DollarSign, Loader2, CheckCircle, Send } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { changePriceAndSend, changePriceOnly } from '../../lib/jarvisActions'

interface PriceChangeSheetProps {
  item: StockItem
  onClose: () => void
  onSuccess: (newPrice: number) => void
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PriceChangeSheet({ item, onClose, onSuccess }: PriceChangeSheetProps) {
  const [newPrice, setNewPrice] = useState(item.sellPrice.toFixed(2))
  const [sendToPos, setSendToPos] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const price = Number(newPrice)
  const margin = price > 0 && item.avgCost > 0
    ? ((price - item.avgCost) / price * 100)
    : null
  const pctChange = item.sellPrice > 0
    ? ((price - item.sellPrice) / item.sellPrice * 100)
    : null

  async function handleApply() {
    if (!price || price <= 0 || !item.barcode) return
    setBusy(true)
    setError(null)
    try {
      const res = sendToPos
        ? await changePriceAndSend(item.barcode, price)
        : await changePriceOnly(item.barcode, price)
      if (res.success) {
        setSuccess(true)
        onSuccess(price)
        setTimeout(onClose, 1200)
      } else {
        setError(res.message ?? 'Price change failed')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-6 space-y-4 pb-safe">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Change Price</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Product info */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-gray-800">{item.description}</p>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Current: <strong className="text-gray-900">${fmtMoney(item.sellPrice)}</strong></span>
            <span>Avg cost: ${fmtMoney(item.avgCost)}</span>
          </div>
        </div>

        {/* New price input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">New Sell Price</label>
          <div className="relative">
            <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 text-lg font-semibold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
          </div>

          {/* Calculated stats */}
          <div className="flex items-center gap-4 text-xs">
            {margin !== null && (
              <span className={`font-medium ${margin < 0 ? 'text-red-600' : margin < 15 ? 'text-amber-600' : 'text-green-600'}`}>
                {margin.toFixed(1)}% margin
              </span>
            )}
            {pctChange !== null && pctChange !== 0 && (
              <span className={`font-medium ${pctChange < 0 ? 'text-red-500' : 'text-green-500'}`}>
                {pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}% change
              </span>
            )}
          </div>
        </div>

        {/* Send to POS toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              checked={sendToPos}
              onChange={e => setSendToPos(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-10 h-5 rounded-full transition-colors ${sendToPos ? 'bg-violet-600' : 'bg-gray-300'}`} />
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${sendToPos ? 'translate-x-5' : ''}`} />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-700">
            <Send size={14} />
            Send to POS terminal
          </div>
        </label>

        {/* Apply button */}
        <button
          onClick={handleApply}
          disabled={busy || !price || price <= 0 || !item.barcode}
          className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : success ? <CheckCircle size={16} /> : null}
          {success ? 'Price Updated!' : busy ? 'Applying...' : 'Apply Price Change'}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}
