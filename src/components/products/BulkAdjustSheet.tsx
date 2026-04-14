import { useState, useMemo, useCallback, useRef } from 'react'
import { Search, X, Loader2, CheckCircle, AlertCircle, Package, ScanBarcode } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { searchItems } from '../../lib/jarvis'
import { adjustStock } from '../../lib/jarvisActions'
import { REASON_CODES } from './ProductCard'
import BarcodeScanner from '../BarcodeScanner'

// UPC-A ↔ EAN-13 interop — same helper shape used in BulkLocationSheet
function barcodeVariants(code: string): string[] {
  const set = new Set([code])
  if (code.startsWith('00')) set.add(code.slice(2))
  if (code.startsWith('0')) set.add(code.slice(1))
  set.add('0' + code)
  return [...set]
}
function normBarcode(bc: string): string { return bc.replace(/^0+/, '') }

interface BulkAdjustSheetProps {
  items: StockItem[]
  onClose: () => void
  onSuccess: () => void
}

interface AdjustEntry {
  item: StockItem
  newQty: string
  status: 'pending' | 'sending' | 'done' | 'error'
  message?: string
}

export default function BulkAdjustSheet({ items, onClose, onSuccess }: BulkAdjustSheetProps) {
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<AdjustEntry[]>([])
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFinding, setScanFinding] = useState(false)
  const [serverHits, setServerHits] = useState<StockItem[]>([])
  const serverTimer = useRef<ReturnType<typeof setTimeout>>()

  const addedCodes = useMemo(() => new Set(entries.map(e => e.item.itemCode)), [entries])

  // Build barcode → item lookup for scanner (from the prop-supplied items).
  // Crew opens this sheet with items=[] and relies on the server-side fallback
  // below; parent opens with a populated list and gets instant local matching.
  const barcodeMap = useMemo(() => {
    const map = new Map<string, StockItem>()
    for (const i of items) if (i.barcode) map.set(i.barcode, i)
    return map
  }, [items])

  const handleScan = useCallback(async (code: string) => {
    setScannerOpen(false)
    // 1. Try the local cache with leading-zero variants (UPC-A ↔ EAN-13)
    let local: StockItem | undefined
    for (const v of barcodeVariants(code)) {
      local = barcodeMap.get(v)
      if (local) break
    }
    if (local) {
      if (!addedCodes.has(local.itemCode)) {
        setEntries(prev => [...prev, { item: local!, newQty: '', status: 'pending' as const }])
      }
      return
    }
    // 2. Server search fallback — try the scanned code, then leading-zero variants
    setScanFinding(true)
    try {
      let res = await searchItems(code, 10, true)
      if (res.items.length === 0) {
        for (const v of barcodeVariants(code)) {
          if (v === code) continue
          res = await searchItems(v, 10, true)
          if (res.items.length > 0) break
        }
      }
      const codeNorm = normBarcode(code)
      const found =
        res.items.find(i => i.barcode != null && normBarcode(i.barcode) === codeNorm) ??
        (res.items.length === 1 ? res.items[0] : null)
      if (found && !addedCodes.has(found.itemCode)) {
        setEntries(prev => [...prev, { item: found, newQty: '', status: 'pending' as const }])
      } else {
        setSearch(code)
      }
    } catch {
      setSearch(code)
    } finally {
      setScanFinding(false)
    }
  }, [barcodeMap, addedCodes])

  function handleSearchChange(value: string) {
    setSearch(value)
    if (serverTimer.current) clearTimeout(serverTimer.current)
    if (!value.trim()) { setServerHits([]); return }
    const trimmed = value.trim()
    const isBarcodeLike = /^\d{8,}$/.test(trimmed)
    if (isBarcodeLike) {
      searchItems(trimmed, 10, true).then(r => setServerHits(r.items)).catch(() => {})
      searchItems('0' + trimmed, 10, true).then(r => setServerHits(prev => {
        const map = new Map(prev.map(i => [i.itemCode, i]))
        for (const item of r.items) if (!map.has(item.itemCode)) map.set(item.itemCode, item)
        return [...map.values()]
      })).catch(() => {})
    } else {
      serverTimer.current = setTimeout(() => {
        searchItems(trimmed, 10, false).then(r => setServerHits(r.items)).catch(() => {})
      }, 300)
    }
  }

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    const qNorm = normBarcode(q)
    const localMatches = items
      .filter(i => !addedCodes.has(i.itemCode) && i.barcode)
      .filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && (i.barcode.includes(q) || normBarcode(i.barcode) === qNorm)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
    const localCodes = new Set(localMatches.map(i => i.itemCode))
    const serverOnly = serverHits.filter(i => !localCodes.has(i.itemCode) && !addedCodes.has(i.itemCode) && i.barcode)
    return [...localMatches, ...serverOnly].slice(0, 10)
  }, [search, items, addedCodes, serverHits])

  function addItem(item: StockItem) {
    setEntries(prev => [...prev, { item, newQty: '', status: 'pending' }])
    setSearch('')
    setServerHits([])
  }

  function removeItem(itemCode: string) {
    setEntries(prev => prev.filter(e => e.item.itemCode !== itemCode))
  }

  function updateQty(itemCode: string, newQty: string) {
    setEntries(prev => prev.map(e =>
      e.item.itemCode === itemCode ? { ...e, newQty } : e
    ))
  }

  async function handleApplyAll() {
    const valid = entries.filter(e => {
      const qty = Number(e.newQty)
      const diff = Math.round(qty) - e.item.onHand
      return !isNaN(qty) && e.newQty !== '' && diff !== 0 && e.item.barcode
    })
    if (valid.length === 0) return

    setProcessing(true)
    setResult(null)
    const reasonText = reason === 'Other' ? customReason : reason

    let ok = 0
    let failed = 0

    for (const entry of valid) {
      const diff = Math.round(Number(entry.newQty)) - entry.item.onHand
      setEntries(prev => prev.map(e =>
        e.item.itemCode === entry.item.itemCode ? { ...e, status: 'sending' } : e
      ))
      try {
        const res = await adjustStock(entry.item.barcode!, diff, reasonText || undefined)
        if (res.success) {
          ok++
          setEntries(prev => prev.map(e =>
            e.item.itemCode === entry.item.itemCode
              ? { ...e, status: 'done', message: res.newQoh !== undefined ? `→ ${res.newQoh}` : 'Done' }
              : e
          ))
        } else {
          failed++
          setEntries(prev => prev.map(e =>
            e.item.itemCode === entry.item.itemCode
              ? { ...e, status: 'error', message: res.message ?? 'Failed' }
              : e
          ))
        }
      } catch (err) {
        failed++
        setEntries(prev => prev.map(e =>
          e.item.itemCode === entry.item.itemCode
            ? { ...e, status: 'error', message: (err as Error).message }
            : e
        ))
      }
    }

    setProcessing(false)
    setResult({ ok, failed })
    if (ok > 0) onSuccess()
  }

  const validCount = entries.filter(e => {
    const qty = Number(e.newQty)
    return !isNaN(qty) && e.newQty !== '' && Math.round(qty) - e.item.onHand !== 0 && e.item.barcode
  }).length

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk QOH Adjustment</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Reason code */}
        <div className="px-4 pt-3 pb-3 border-b border-gray-100 shrink-0 space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase">Reason (applies to all)</label>
          <div className="flex flex-wrap gap-1.5">
            {REASON_CODES.map(r => (
              <button
                key={r}
                onClick={() => setReason(reason === r ? '' : r)}
                disabled={processing}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                  reason === r
                    ? 'bg-violet-100 border-violet-300 text-violet-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                {r}
              </button>
            ))}
          </div>
          {reason === 'Other' && (
            <input
              type="text"
              value={customReason}
              onChange={e => setCustomReason(e.target.value)}
              placeholder="Describe reason..."
              disabled={processing}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          )}
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search or scan products..."
                className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                disabled={processing}
              />
              {search && (
                <button onClick={() => handleSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              disabled={processing || scanFinding}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-violet-600 hover:border-violet-300 disabled:opacity-50"
              title="Scan barcode"
            >
              {scanFinding ? <Loader2 size={18} className="animate-spin" /> : <ScanBarcode size={18} />}
            </button>
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
                    <p className="text-xs text-gray-400">QOH: {item.onHand} · {item.barcode}</p>
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
              Search and add products to adjust quantities
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => {
                const qty = Number(entry.newQty)
                const diff = !isNaN(qty) && entry.newQty !== '' ? Math.round(qty) - entry.item.onHand : null

                return (
                  <div key={entry.item.itemCode} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{entry.item.description}</p>
                        <p className="text-xs text-gray-400">
                          Current QOH: <strong className="text-gray-600">{entry.item.onHand}</strong>
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {entry.status === 'sending' && <Loader2 size={14} className="animate-spin text-violet-500" />}
                        {entry.status === 'done' && <CheckCircle size={14} className="text-green-500" />}
                        {entry.status === 'error' && <AlertCircle size={14} className="text-red-500" />}
                        {entry.status === 'pending' && !processing && (
                          <button onClick={() => removeItem(entry.item.itemCode)} className="text-gray-400 hover:text-red-500">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={entry.newQty}
                          onChange={e => updateQty(entry.item.itemCode, e.target.value)}
                          placeholder="New QOH"
                          disabled={processing || entry.status !== 'pending'}
                          className="w-full px-2 py-1.5 text-sm font-medium border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-100"
                        />
                      </div>
                      {diff !== null && diff !== 0 && (
                        <span className={`text-xs font-medium shrink-0 ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                      {entry.message && (
                        <span className={`text-[11px] shrink-0 ${entry.status === 'error' ? 'text-red-500' : 'text-green-500'}`}>
                          {entry.message}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 shrink-0">
          {result ? (
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-green-600 flex items-center justify-center gap-1">
                <CheckCircle size={14} />
                {result.ok} adjusted
                {result.failed > 0 && <span className="text-red-600"> · {result.failed} failed</span>}
              </p>
              <button onClick={onClose} className="text-sm text-violet-600 underline">Close</button>
            </div>
          ) : (
            <button
              onClick={handleApplyAll}
              disabled={processing || validCount === 0}
              className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? (
                <><Loader2 size={16} className="animate-spin" /> Adjusting...</>
              ) : (
                <><Package size={16} /> Adjust {validCount} Item{validCount !== 1 ? 's' : ''}</>
              )}
            </button>
          )}
        </div>
      </div>

      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
