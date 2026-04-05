import { useState, useMemo } from 'react'
import { Search, X, Loader2, CheckCircle, AlertCircle, Send } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { changePriceAndSend, changePriceOnly } from '../../lib/jarvisActions'

interface BulkPriceChangeSheetProps {
  items: StockItem[]
  onClose: () => void
  onSuccess: () => void
}

interface PriceEntry {
  item: StockItem
  newPrice: string
  status: 'pending' | 'sending' | 'done' | 'error'
  message?: string
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BulkPriceChangeSheet({ items, onClose, onSuccess }: BulkPriceChangeSheetProps) {
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<PriceEntry[]>([])
  const [sendToPos, setSendToPos] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [done, setDone] = useState(false)

  // Filter items for selection (exclude already-added)
  const addedCodes = useMemo(() => new Set(entries.map(e => e.item.itemCode)), [entries])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return items
      .filter(i => !addedCodes.has(i.itemCode))
      .filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
      .slice(0, 10)
  }, [search, items, addedCodes])

  function addItem(item: StockItem) {
    setEntries(prev => [...prev, { item, newPrice: item.sellPrice.toFixed(2), status: 'pending' }])
    setSearch('')
  }

  function removeItem(itemCode: string) {
    setEntries(prev => prev.filter(e => e.item.itemCode !== itemCode))
  }

  function updatePrice(itemCode: string, newPrice: string) {
    setEntries(prev => prev.map(e =>
      e.item.itemCode === itemCode ? { ...e, newPrice } : e
    ))
  }

  async function handleApplyAll() {
    if (entries.length === 0) return
    setProcessing(true)

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const price = Number(entry.newPrice)
      if (!price || price <= 0 || !entry.item.barcode) {
        setEntries(prev => prev.map((e, j) => j === i ? { ...e, status: 'error', message: 'Invalid price or barcode' } : e))
        continue
      }

      setEntries(prev => prev.map((e, j) => j === i ? { ...e, status: 'sending' } : e))

      try {
        const res = sendToPos
          ? await changePriceAndSend(entry.item.barcode, price)
          : await changePriceOnly(entry.item.barcode, price)

        setEntries(prev => prev.map((e, j) => j === i
          ? { ...e, status: res.success ? 'done' : 'error', message: res.success ? undefined : (res.message ?? 'Failed') }
          : e
        ))
      } catch (err) {
        setEntries(prev => prev.map((e, j) => j === i
          ? { ...e, status: 'error', message: (err as Error).message }
          : e
        ))
      }
    }

    setProcessing(false)
    setDone(true)
    onSuccess()
  }

  const pendingCount = entries.filter(e => e.status === 'pending').length
  const doneCount = entries.filter(e => e.status === 'done').length
  const errorCount = entries.filter(e => e.status === 'error').length

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[85vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk Price Change</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Search to add items */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products to add..."
              className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              disabled={processing}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-auto">
              {searchResults.map(item => (
                <button
                  key={item.itemCode}
                  onClick={() => addItem(item)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{item.description}</p>
                    <p className="text-xs text-gray-400">{item.barcode} · ${fmtMoney(item.sellPrice)}</p>
                  </div>
                  <span className="text-xs text-violet-600 font-medium shrink-0 ml-2">Add</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected items list */}
        <div className="flex-1 overflow-auto px-4 pb-2">
          {entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              Search and add products to change their prices
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => {
                const price = Number(entry.newPrice)
                const pctChange = entry.item.sellPrice > 0 && price > 0
                  ? ((price - entry.item.sellPrice) / entry.item.sellPrice * 100)
                  : null

                return (
                  <div
                    key={entry.item.itemCode}
                    className={`border rounded-lg p-3 space-y-1.5 ${
                      entry.status === 'done' ? 'border-green-200 bg-green-50' :
                      entry.status === 'error' ? 'border-red-200 bg-red-50' :
                      entry.status === 'sending' ? 'border-violet-200 bg-violet-50' :
                      'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{entry.item.description}</p>
                        <p className="text-xs text-gray-400">Current: ${fmtMoney(entry.item.sellPrice)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {entry.status === 'done' && <CheckCircle size={16} className="text-green-500" />}
                        {entry.status === 'error' && <AlertCircle size={16} className="text-red-500" />}
                        {entry.status === 'sending' && <Loader2 size={16} className="animate-spin text-violet-500" />}
                        {entry.status === 'pending' && !processing && (
                          <button onClick={() => removeItem(entry.item.itemCode)} className="text-gray-400 hover:text-red-500">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={entry.newPrice}
                          onChange={e => updatePrice(entry.item.itemCode, e.target.value)}
                          disabled={entry.status !== 'pending' || processing}
                          className="w-full pl-6 pr-2 py-1.5 text-sm font-medium border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-100"
                        />
                      </div>
                      {pctChange !== null && pctChange !== 0 && (
                        <span className={`text-xs font-medium shrink-0 ${pctChange < 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {entry.message && (
                      <p className="text-xs text-red-600">{entry.message}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 space-y-3 shrink-0">
          {/* Send to POS toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={sendToPos} onChange={e => setSendToPos(e.target.checked)} className="sr-only" disabled={processing} />
              <div className={`w-10 h-5 rounded-full transition-colors ${sendToPos ? 'bg-violet-600' : 'bg-gray-300'}`} />
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${sendToPos ? 'translate-x-5' : ''}`} />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-700">
              <Send size={14} /> Send to POS terminal
            </div>
          </label>

          {done ? (
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-green-600">{doneCount} updated{errorCount > 0 ? `, ${errorCount} failed` : ''}</p>
              <button onClick={onClose} className="text-sm text-violet-600 underline">Close</button>
            </div>
          ) : (
            <button
              onClick={handleApplyAll}
              disabled={processing || entries.length === 0 || pendingCount === 0}
              className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? (
                <><Loader2 size={16} className="animate-spin" /> Processing {entries.length - pendingCount}/{entries.length}...</>
              ) : (
                <>Apply {entries.length} Price Change{entries.length !== 1 ? 's' : ''}</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
