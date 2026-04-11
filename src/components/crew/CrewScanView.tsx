import { useState, useEffect, useCallback, useRef } from 'react'
import { ScanBarcode, Search, Loader2, MapPin, CalendarClock, Printer } from 'lucide-react'
import type { StockItem, LivePromotion, ItemLocation } from '../../lib/jarvis'
import { searchItems, getItemLocations, getPromotions } from '../../lib/jarvis'
import { formatItemLocation } from '../../lib/locationUtils'
import { db, type ExpiryRecord } from '../../lib/db'
import ProductImage from '../ProductImage'
import BarcodeScanner from '../BarcodeScanner'
import PrintLabelSheet from '../products/PrintLabelSheet'

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysUntil(iso: string) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(iso + 'T00:00:00')
  return Math.ceil((target.getTime() - now.getTime()) / 86400000)
}

export default function CrewScanView() {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [item, setItem] = useState<StockItem | null>(null)
  const [promo, setPromo] = useState<LivePromotion | null>(null)
  const [locations, setLocations] = useState<ItemLocation[]>([])
  const [expiries, setExpiries] = useState<ExpiryRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [printItem, setPrintItem] = useState<StockItem | null>(null)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  const lookup = useCallback(async (code: string) => {
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    setItem(null)
    setPromo(null)
    setLocations([])
    setExpiries([])

    try {
      const trimmed = code.trim()
      let results = await searchItems(trimmed, 5, true)
      // UPC-A ↔ EAN-13: the POS may store with a different number of leading
      // zeros. Try stripped and prepended variants until we get a hit.
      if (!results.items?.length) {
        const variants = new Set<string>()
        if (trimmed.startsWith('0')) variants.add(trimmed.slice(1))
        if (trimmed.startsWith('00')) variants.add(trimmed.slice(2))
        variants.add('0' + trimmed)
        variants.delete(trimmed)
        for (const v of variants) {
          results = await searchItems(v, 5, true)
          if (results.items?.length) break
        }
      }
      if (!results.items?.length) {
        setError('Product not found')
        return
      }
      // Prefer exact barcode match (normalized), fall back to first result
      const codeNorm = trimmed.replace(/^0+/, '')
      const found = results.items.find(i =>
        i.barcode != null && i.barcode.replace(/^0+/, '') === codeNorm
      ) ?? results.items[0]
      if (!mounted.current) return
      setItem(found)

      // Load locations, expiries, promos in parallel
      const [locs, exps, promoData] = await Promise.all([
        getItemLocations(found.itemCode).catch(() => [] as ItemLocation[]),
        db.expiryRecords
          .where('itemCode').equals(found.itemCode)
          .and(r => r.status === 'active')
          .sortBy('expiryDate'),
        getPromotions().catch(() => ({ items: [] as LivePromotion[] })),
      ])

      if (!mounted.current) return
      setLocations(locs)
      setExpiries(exps)
      const p = (promoData.items ?? []).find(pr => pr.itemCode === found.itemCode)
      if (p) setPromo(p)
    } catch (err) {
      if (mounted.current) setError((err as Error).message)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  function handleScan(code: string) {
    setScannerOpen(false)
    setManualCode(code)
    lookup(code)
  }

  function handleManualSearch() {
    lookup(manualCode)
  }


  return (
    <div className="flex flex-col h-full">
      {/* Scan area */}
      <div className="px-4 pt-6 pb-4 shrink-0 space-y-4">
        <div className="text-center space-y-1">
          <ScanBarcode size={32} className="mx-auto text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">Quick Lookup</h2>
          <p className="text-xs text-gray-400">Scan a barcode or type to search</p>
        </div>

        <button
          onClick={() => setScannerOpen(true)}
          className="w-full py-4 bg-blue-600 text-white text-base font-semibold rounded-2xl flex items-center justify-center gap-2 active:bg-blue-700 transition-colors shadow-sm"
        >
          <ScanBarcode size={20} />
          Scan Barcode
        </button>

        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
              placeholder="Barcode or product name..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            onClick={handleManualSearch}
            disabled={!manualCode.trim() || loading}
            className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Looking up...</span>
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-8">
            <p className="text-sm font-medium text-red-600">{error}</p>
            <p className="text-xs text-gray-400 mt-1">Try scanning again or search by name</p>
          </div>
        )}

        {item && !loading && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Product header */}
            <div className="flex items-center gap-3 p-4">
              <ProductImage
                itemCode={item.itemCode}
                description={item.description}
                department={item.department}
                barcode={item.barcode}
                size={64}
                className="rounded-xl"
              />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-gray-900">{item.description}</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">${fmtMoney(item.sellPrice)}</p>
                {item.barcode && <p className="text-xs text-gray-400 font-mono mt-0.5">{item.barcode}</p>}
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-3 gap-px bg-gray-100 border-t border-gray-100">
              <div className="bg-white p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase font-medium">QOH</p>
                <p className={`text-lg font-bold ${
                  item.onHand <= 0 ? 'text-red-600' : item.onHand <= item.reorderLevel ? 'text-amber-600' : 'text-emerald-600'
                }`}>{item.onHand}</p>
              </div>
              <div className="bg-white p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase font-medium">Reorder</p>
                <p className="text-lg font-bold text-gray-800">{item.reorderLevel}</p>
              </div>
              <div className="bg-white p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase font-medium">On Order</p>
                <p className="text-lg font-bold text-gray-800">{item.onOrder}</p>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Promo */}
              {promo && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-amber-700">PROMO</span>
                    <span className="text-[10px] text-amber-600">{promo.daysLeft}d left</span>
                  </div>
                  <p className="text-base font-bold text-amber-800">${fmtMoney(promo.promoPrice)}
                    <span className="text-xs text-amber-600 font-normal ml-1">was ${fmtMoney(promo.normalPrice)}</span>
                  </p>
                </div>
              )}

              {/* Location */}
              <div className="flex items-start gap-2">
                <MapPin size={16} className="text-blue-500 mt-0.5 shrink-0" />
                <div className="text-sm text-gray-700">
                  {locations.length > 0
                    ? locations.map(l => (
                        <span key={l.locationId} className="block">
                          {formatItemLocation(l)}
                        </span>
                      ))
                    : <span className="text-gray-400">No location set</span>
                  }
                </div>
              </div>

              {/* Expiry */}
              {expiries.length > 0 && (
                <div className="flex items-start gap-2">
                  <CalendarClock size={16} className="text-orange-500 mt-0.5 shrink-0" />
                  <div className="text-sm text-gray-700 space-y-0.5">
                    {expiries.slice(0, 3).map(e => {
                      const days = daysUntil(e.expiryDate)
                      return (
                        <div key={e.id} className="flex items-center gap-2">
                          <span className={days <= 14 ? 'text-red-600 font-medium' : days <= 30 ? 'text-amber-600' : ''}>
                            {fmtDate(e.expiryDate)}
                          </span>
                          {days <= 30 && (
                            <span className={`text-[10px] font-bold ${days <= 14 ? 'text-red-600' : 'text-amber-600'}`}>
                              {days <= 0 ? 'EXPIRED' : `${days}d`}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setPrintItem(item)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-colors"
                >
                  <Printer size={16} /> Print Label
                </button>
              </div>
            </div>
          </div>
        )}

        {!item && !loading && !error && (
          <div className="text-center py-12 text-gray-300">
            <ScanBarcode size={48} className="mx-auto mb-3" />
            <p className="text-sm">Scan a product to see details</p>
          </div>
        )}
      </div>

      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
      {printItem && <PrintLabelSheet item={printItem} onClose={() => setPrintItem(null)} />}
    </div>
  )
}
