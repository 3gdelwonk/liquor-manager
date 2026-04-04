import { useState } from 'react'
import { Loader2, CheckCircle, Tag, Calendar } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { createPromo } from '../../lib/jarvisActions'

interface CreatePromoSheetProps {
  item: StockItem
  onClose: () => void
  onSuccess: () => void
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CreatePromoSheet({ item, onClose, onSuccess }: CreatePromoSheetProps) {
  const today = new Date().toISOString().slice(0, 10)
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)

  const [promoPrice, setPromoPrice] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(twoWeeks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const price = Number(promoPrice)
  const discount = item.sellPrice > 0 && price > 0
    ? ((item.sellPrice - price) / item.sellPrice * 100)
    : null
  const margin = price > 0 && item.avgCost > 0
    ? ((price - item.avgCost) / price * 100)
    : null

  async function handleCreate() {
    if (!price || price <= 0 || !item.barcode || !startDate || !endDate) return
    setBusy(true)
    setError(null)
    try {
      const res = await createPromo({
        barcode: item.barcode,
        promoPrice: price,
        startDate,
        endDate,
        description: item.description,
      })
      if (res.success) {
        setSuccess(true)
        onSuccess()
        setTimeout(onClose, 1200)
      } else {
        setError(res.message ?? 'Failed to create promotion')
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
          <h2 className="text-base font-semibold text-gray-900">Create Promotion</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Product info */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-gray-800">{item.description}</p>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Current price: <strong className="text-gray-900">${fmtMoney(item.sellPrice)}</strong></span>
            <span className="font-mono text-gray-400">{item.barcode}</span>
          </div>
        </div>

        {/* Promo price */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Promo Sell Price</label>
          <div className="relative">
            <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={promoPrice}
              onChange={e => setPromoPrice(e.target.value)}
              placeholder="0.00"
              className="w-full pl-8 pr-3 py-2.5 text-lg font-semibold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-4 text-xs">
            {discount !== null && discount > 0 && (
              <span className="font-medium text-green-600">{discount.toFixed(1)}% off</span>
            )}
            {margin !== null && (
              <span className={`font-medium ${margin < 0 ? 'text-red-600' : margin < 15 ? 'text-amber-600' : 'text-green-600'}`}>
                {margin.toFixed(1)}% margin at promo
              </span>
            )}
          </div>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <Calendar size={12} /> Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <Calendar size={12} /> End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={busy || !price || price <= 0 || !item.barcode || !startDate || !endDate}
          className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : success ? <CheckCircle size={16} /> : null}
          {success ? 'Promotion Created!' : busy ? 'Creating...' : 'Create Promotion & Send to POS'}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}
