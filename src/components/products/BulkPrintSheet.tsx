import { useState, useEffect, useMemo } from 'react'
import { Search, X, Loader2, CheckCircle, AlertCircle, Printer, Hash } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { getPrinters, type Printer as PrinterType } from '../../lib/jarvis'
import { printLabel } from '../../lib/jarvisActions'

interface BulkPrintSheetProps {
  items: StockItem[]
  onClose: () => void
}

interface PrintEntry {
  item: StockItem
  qty: number
  status: 'pending' | 'sending' | 'done' | 'error'
  message?: string
}

const LABEL_FORMATS = [
  { key: 'shelf', label: 'Shelf Label' },
  { key: 'barcode', label: 'Barcode Only' },
  { key: 'promo', label: 'Promo Tag' },
  { key: 'bin', label: 'Bin Label' },
]

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BulkPrintSheet({ items, onClose }: BulkPrintSheetProps) {
  const [printers, setPrinters] = useState<PrinterType[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(true)
  const [selectedPrinter, setSelectedPrinter] = useState<number | null>(null)
  const [format, setFormat] = useState('shelf')
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<PrintEntry[]>([])
  const [processing, setProcessing] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    getPrinters()
      .then(list => {
        setPrinters(list.filter(p => p.isLabel))
        const first = list.find(p => p.isLabel)
        if (first) setSelectedPrinter(first.id)
      })
      .catch(() => {})
      .finally(() => setLoadingPrinters(false))
  }, [])

  const addedCodes = useMemo(() => new Set(entries.map(e => e.item.itemCode)), [entries])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return items
      .filter(i => !addedCodes.has(i.itemCode) && i.barcode)
      .filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
      .slice(0, 10)
  }, [search, items, addedCodes])

  function addItem(item: StockItem) {
    setEntries(prev => [...prev, { item, qty: 1, status: 'pending' }])
    setSearch('')
  }

  function removeItem(itemCode: string) {
    setEntries(prev => prev.filter(e => e.item.itemCode !== itemCode))
  }

  function updateQty(itemCode: string, qty: number) {
    setEntries(prev => prev.map(e =>
      e.item.itemCode === itemCode ? { ...e, qty: Math.max(1, Math.min(50, qty)) } : e
    ))
  }

  async function handlePrintAll() {
    if (entries.length === 0 || !selectedPrinter) return
    setProcessing(true)

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry.item.barcode) {
        setEntries(prev => prev.map((e, j) => j === i ? { ...e, status: 'error', message: 'No barcode' } : e))
        continue
      }

      setEntries(prev => prev.map((e, j) => j === i ? { ...e, status: 'sending' } : e))

      try {
        const res = await printLabel(entry.item.barcode, {
          printerId: selectedPrinter,
          qty: entry.qty,
          format,
        })
        setEntries(prev => prev.map((e, j) => j === i
          ? { ...e, status: (res.success || res.ok) ? 'done' : 'error', message: (res.success || res.ok) ? undefined : (res.message ?? 'Failed') }
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
  }

  const totalLabels = entries.reduce((s, e) => s + e.qty, 0)
  const doneCount = entries.filter(e => e.status === 'done').length
  const errorCount = entries.filter(e => e.status === 'error').length

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk Print Labels</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Printer + Format selection */}
        <div className="px-4 pt-3 space-y-3 shrink-0 border-b border-gray-100 pb-3">
          {/* Printer */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 uppercase">Printer</label>
            {loadingPrinters ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {printers.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPrinter(p.id)}
                    disabled={processing}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedPrinter === p.id
                        ? 'border-violet-500 bg-violet-50 text-violet-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <Printer size={12} />
                    <span className="truncate max-w-[120px]">{p.name}</span>
                    {p.queueRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Format */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 uppercase">Format</label>
            <div className="flex flex-wrap gap-1.5">
              {LABEL_FORMATS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFormat(f.key)}
                  disabled={processing}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    format === f.key
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
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
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-auto">
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

        {/* Items list */}
        <div className="flex-1 overflow-auto px-4 pb-2">
          {entries.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">
              Search and add products to print labels
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <div
                  key={entry.item.itemCode}
                  className={`border rounded-lg p-3 ${
                    entry.status === 'done' ? 'border-green-200 bg-green-50' :
                    entry.status === 'error' ? 'border-red-200 bg-red-50' :
                    entry.status === 'sending' ? 'border-violet-200 bg-violet-50' :
                    'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{entry.item.description}</p>
                      <p className="text-xs text-gray-400">{entry.item.barcode} · ${fmtMoney(entry.item.sellPrice)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {entry.status === 'pending' && !processing && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateQty(entry.item.itemCode, entry.qty - 1)}
                            className="w-6 h-6 rounded border border-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center"
                          >
                            -
                          </button>
                          <span className="text-sm font-medium text-gray-700 w-5 text-center">{entry.qty}</span>
                          <button
                            onClick={() => updateQty(entry.item.itemCode, entry.qty + 1)}
                            className="w-6 h-6 rounded border border-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center"
                          >
                            +
                          </button>
                        </div>
                      )}
                      {entry.status === 'pending' && !processing && (
                        <button onClick={() => removeItem(entry.item.itemCode)} className="text-gray-400 hover:text-red-500">
                          <X size={16} />
                        </button>
                      )}
                      {entry.status === 'done' && <CheckCircle size={16} className="text-green-500" />}
                      {entry.status === 'error' && <AlertCircle size={16} className="text-red-500" />}
                      {entry.status === 'sending' && <Loader2 size={16} className="animate-spin text-violet-500" />}
                      {(entry.status === 'done' || entry.status === 'sending') && (
                        <span className="flex items-center gap-0.5 text-xs text-gray-500"><Hash size={10} />{entry.qty}</span>
                      )}
                    </div>
                  </div>
                  {entry.message && <p className="text-xs text-red-600 mt-1">{entry.message}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 shrink-0">
          {done ? (
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-green-600">
                {doneCount} item{doneCount !== 1 ? 's' : ''} printed ({totalLabels} label{totalLabels !== 1 ? 's' : ''})
                {errorCount > 0 && <span className="text-red-600"> · {errorCount} failed</span>}
              </p>
              <button onClick={onClose} className="text-sm text-violet-600 underline">Close</button>
            </div>
          ) : (
            <button
              onClick={handlePrintAll}
              disabled={processing || entries.length === 0 || !selectedPrinter}
              className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? (
                <><Loader2 size={16} className="animate-spin" /> Printing...</>
              ) : (
                <><Printer size={16} /> Print {totalLabels} Label{totalLabels !== 1 ? 's' : ''} ({entries.length} item{entries.length !== 1 ? 's' : ''})</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
