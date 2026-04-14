import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Search, X, Loader2, ScanBarcode, MapPin, Package, DollarSign, Tag, AlertCircle,
} from 'lucide-react'
import type { StockItem, ItemLocation, LivePromotion } from '../../lib/jarvis'
import { searchItems, getItemLocations, getPromotions } from '../../lib/jarvis'
import { formatItemLocation } from '../../lib/locationUtils'
import BarcodeScanner from '../BarcodeScanner'

function barcodeVariants(code: string): string[] {
  const set = new Set([code])
  if (code.startsWith('00')) set.add(code.slice(2))
  if (code.startsWith('0')) set.add(code.slice(1))
  set.add('0' + code)
  return [...set]
}
function normBarcode(bc: string): string { return bc.replace(/^0+/, '') }

function fmtMoney(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface CrewLookupSheetProps {
  onClose: () => void
}

export default function CrewLookupSheet({ onClose }: CrewLookupSheetProps) {
  const [search, setSearch]           = useState('')
  const [serverHits, setServerHits]   = useState<StockItem[]>([])
  const serverTimer                   = useRef<ReturnType<typeof setTimeout>>()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFinding, setScanFinding] = useState(false)

  const [picked, setPicked]           = useState<StockItem | null>(null)
  const [promo, setPromo]             = useState<LivePromotion | null>(null)
  const [locations, setLocations]     = useState<ItemLocation[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)

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
    () => serverHits.slice(0, 10),
    [serverHits],
  )

  const loadDetails = useCallback(async (item: StockItem) => {
    setDetailsLoading(true)
    setPromo(null)
    setLocations([])
    setErrorMsg(null)
    try {
      const [locs, promoData] = await Promise.all([
        getItemLocations(item.itemCode).catch(() => [] as ItemLocation[]),
        getPromotions().catch(() => ({ items: [] as LivePromotion[] })),
      ])
      setLocations(locs)
      const p = (promoData.items ?? []).find(pr => pr.itemCode === item.itemCode) ?? null
      setPromo(p)
    } catch (err) {
      setErrorMsg((err as Error).message)
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  function pickItem(item: StockItem) {
    setPicked(item)
    setSearch('')
    setServerHits([])
    loadDetails(item)
  }

  function clearPick() {
    setPicked(null)
    setPromo(null)
    setLocations([])
    setErrorMsg(null)
  }

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
        pickItem(found)
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

  const qohTone =
    picked == null
      ? 'text-gray-400'
      : picked.onHand <= 0
        ? 'text-red-600'
        : picked.onHand <= picked.reorderLevel
          ? 'text-amber-600'
          : 'text-emerald-600'

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Search size={18} className="text-indigo-500" />
            Item Lookup
          </h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Search bar */}
        {!picked && (
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Search or scan a product..."
                  className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
                className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-50"
                title="Scan barcode"
              >
                {scanFinding ? <Loader2 size={18} className="animate-spin" /> : <ScanBarcode size={18} />}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                {searchResults.map(item => (
                  <button
                    key={item.itemCode}
                    onClick={() => pickItem(item)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{item.description}</p>
                      <p className="text-xs text-gray-400">
                        ${fmtMoney(item.sellPrice)} · {item.barcode ?? 'no barcode'}
                      </p>
                    </div>
                    <span className="text-xs text-indigo-600 font-medium shrink-0 ml-2">Pick</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Picked item details */}
        {picked && (
          <div className="flex-1 overflow-auto px-4 pt-3 pb-4 space-y-3">
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{picked.description}</p>
                  <p className="text-xs text-gray-400">
                    {picked.itemCode} · {picked.barcode ?? 'no barcode'}
                  </p>
                </div>
                <button
                  onClick={clearPick}
                  className="text-xs text-indigo-600 font-medium shrink-0 underline"
                >
                  Change
                </button>
              </div>
            </div>

            {/* QOH */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Package size={14} className="text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Quantity on hand</p>
              </div>
              <p className={`text-3xl font-bold ${qohTone}`}>{picked.onHand}</p>
            </div>

            {/* Current price */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={14} className="text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Current price</p>
              </div>
              <p className="text-3xl font-bold text-gray-900">${fmtMoney(picked.sellPrice)}</p>
            </div>

            {/* Promotion */}
            <div className={`rounded-lg p-4 border ${promo ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-1">
                <Tag size={14} className={promo ? 'text-amber-600' : 'text-gray-400'} />
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${promo ? 'text-amber-700' : 'text-gray-500'}`}>
                  Promotion
                </p>
                {promo && (
                  <span className="ml-auto text-[10px] text-amber-600">{promo.daysLeft}d left</span>
                )}
              </div>
              {detailsLoading ? (
                <p className="text-sm text-gray-400 flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </p>
              ) : promo ? (
                <>
                  <p className="text-3xl font-bold text-amber-800">${fmtMoney(promo.promoPrice)}</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Was <span className="line-through">${fmtMoney(promo.normalPrice)}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">No active promotion</p>
              )}
            </div>

            {/* Locations */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={14} className="text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Locations</p>
              </div>
              {detailsLoading ? (
                <p className="text-sm text-gray-400 flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </p>
              ) : locations.length === 0 ? (
                <p className="text-sm text-gray-500">No locations assigned</p>
              ) : (
                <ul className="space-y-1">
                  {locations.map(loc => (
                    <li key={loc.locationId} className="text-sm text-gray-800">
                      {formatItemLocation(loc)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {errorMsg && (
              <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                <AlertCircle size={12} /> {errorMsg}
              </p>
            )}
          </div>
        )}

        {!picked && (
          <div className="flex-1 overflow-auto px-4 pb-4 text-center text-sm text-gray-400 pt-6">
            Scan or search to look up a product
          </div>
        )}
      </div>

      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
