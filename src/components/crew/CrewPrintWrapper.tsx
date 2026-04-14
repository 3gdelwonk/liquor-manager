import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Search, X, Loader2, ScanBarcode, Printer } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { searchItems } from '../../lib/jarvis'
import BarcodeScanner from '../BarcodeScanner'
import PrintLabelSheet from '../products/PrintLabelSheet'

function barcodeVariants(code: string): string[] {
  const set = new Set([code])
  if (code.startsWith('00')) set.add(code.slice(2))
  if (code.startsWith('0')) set.add(code.slice(1))
  set.add('0' + code)
  return [...set]
}
function normBarcode(bc: string): string { return bc.replace(/^0+/, '') }

interface CrewPrintWrapperProps {
  onClose: () => void
}

export default function CrewPrintWrapper({ onClose }: CrewPrintWrapperProps) {
  const [search, setSearch]           = useState('')
  const [serverHits, setServerHits]   = useState<StockItem[]>([])
  const serverTimer                   = useRef<ReturnType<typeof setTimeout>>()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFinding, setScanFinding] = useState(false)
  const [picked, setPicked]           = useState<StockItem | null>(null)

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

  const searchResults = useMemo(
    () => serverHits.filter(i => i.barcode).slice(0, 10),
    [serverHits],
  )

  const handleScan = useCallback(async (code: string) => {
    setScannerOpen(false)
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
      if (found) {
        setPicked(found)
      } else {
        setSearch(code)
        setServerHits(res.items)
      }
    } catch {
      setSearch(code)
    } finally {
      setScanFinding(false)
    }
  }, [])

  useEffect(() => () => {
    if (serverTimer.current) clearTimeout(serverTimer.current)
  }, [])

  // Once an item is picked, hand control to the existing parent sheet.
  // Closing it returns to the search view (not all the way out) so crew
  // can print labels for multiple items in one session.
  if (picked) {
    return <PrintLabelSheet item={picked} onClose={() => setPicked(null)} />
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Printer size={18} className="text-violet-500" />
            Print Labels
          </h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Search bar */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search or scan a product..."
                className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
              {search && (
                <button onClick={() => handleSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              disabled={scanFinding}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-violet-600 hover:border-violet-300 disabled:opacity-50"
              title="Scan barcode"
            >
              {scanFinding ? <Loader2 size={18} className="animate-spin" /> : <ScanBarcode size={18} />}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
              {searchResults.map(item => (
                <button
                  key={item.itemCode}
                  onClick={() => setPicked(item)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{item.description}</p>
                    <p className="text-xs text-gray-400">
                      ${item.sellPrice.toFixed(2)} · {item.barcode}
                    </p>
                  </div>
                  <span className="text-xs text-violet-600 font-medium shrink-0 ml-2">Pick</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto px-4 pb-4 text-center text-sm text-gray-400 pt-6">
          Scan or search a product to print its label
        </div>
      </div>

      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
