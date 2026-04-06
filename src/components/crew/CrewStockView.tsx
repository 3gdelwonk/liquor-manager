import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Loader2, RefreshCw, ScanBarcode, ChevronDown, Printer, Zap } from 'lucide-react'
import type { StockItem, LivePromotion } from '../../lib/jarvis'
import { checkConnection, getStockLevels, getPromotions, LIQUOR_DEPT_NAMES } from '../../lib/jarvis'
import CrewProductCard from './CrewProductCard'
import PrintLabelSheet from '../products/PrintLabelSheet'
import BarcodeScanner from '../BarcodeScanner'

const DEPARTMENTS = ['All', 'WINE', 'BEER', 'SPIRITS', 'LIQUEURS', 'LIQUOR/MISC'] as const
type DeptFilter = typeof DEPARTMENTS[number]

const DEPT_COLORS: Record<string, string> = {
  All: 'bg-gray-100 text-gray-700 border-gray-300',
  WINE: 'bg-violet-50 text-violet-700 border-violet-300',
  BEER: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  SPIRITS: 'bg-blue-50 text-blue-700 border-blue-300',
  LIQUEURS: 'bg-amber-50 text-amber-700 border-amber-300',
  'LIQUOR/MISC': 'bg-pink-50 text-pink-700 border-pink-300',
}

export default function CrewStockView() {
  const [items, setItems] = useState<StockItem[]>([])
  const [promos, setPromos] = useState<LivePromotion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('All')
  const [segment, setSegment] = useState<'all' | 'promo' | 'low'>('all')
  const [displayLimit, setDisplayLimit] = useState(50)

  const [scannerOpen, setScannerOpen] = useState(false)
  const [printItem, setPrintItem] = useState<StockItem | null>(null)

  const promoMap = useMemo(() => {
    const map = new Map<string, LivePromotion>()
    for (const p of promos) map.set(p.itemCode, p)
    return map
  }, [promos])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await checkConnection()
      const [stock, promoData] = await Promise.all([
        getStockLevels({ limit: 5000 }),
        getPromotions(),
      ])
      setItems(stock.filter(s => LIQUOR_DEPT_NAMES.has(s.department)))
      setPromos(promoData.items ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh every 5 min
  useEffect(() => {
    const id = setInterval(fetchData, 300_000)
    return () => clearInterval(id)
  }, [fetchData])

  // Filter and search
  const displayed = useMemo(() => {
    let list = items

    if (deptFilter !== 'All') {
      list = list.filter(i => i.department === deptFilter)
    }

    if (segment === 'promo') {
      list = list.filter(i => promoMap.has(i.itemCode))
    } else if (segment === 'low') {
      list = list.filter(i => i.onHand <= i.reorderLevel)
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
    }

    return list
  }, [items, deptFilter, segment, search, promoMap])

  const paginated = useMemo(() => displayed.slice(0, displayLimit), [displayed, displayLimit])

  // Reset pagination on filter changes
  useEffect(() => { setDisplayLimit(50) }, [search, deptFilter, segment])

  // Department counts
  const deptCounts = useMemo(() => {
    const counts: Record<string, number> = { All: items.length }
    for (const i of items) counts[i.department] = (counts[i.department] ?? 0) + 1
    return counts
  }, [items])

  function handleScan(code: string) {
    setScannerOpen(false)
    setSearch(code)
  }

  const promoCount = useMemo(() => items.filter(i => promoMap.has(i.itemCode)).length, [items, promoMap])
  const lowCount = useMemo(() => items.filter(i => i.onHand <= i.reorderLevel).length, [items])

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">Loading stock...</p>
      </div>
    )
  }

  if (error && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <p className="text-sm font-medium text-red-600">{error}</p>
        <button onClick={fetchData} className="text-sm text-blue-600 underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + scan bar */}
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-8 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-gray-50"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setScannerOpen(true)}
            className="px-3 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            title="Scan barcode"
          >
            <ScanBarcode size={18} />
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-2.5 border border-gray-200 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Segment pills */}
        <div className="flex gap-1.5">
          <SegmentPill active={segment === 'all'} onClick={() => setSegment('all')} label={`All (${items.length})`} />
          <SegmentPill active={segment === 'promo'} onClick={() => setSegment('promo')} label={`Promo (${promoCount})`} color="amber" />
          <SegmentPill active={segment === 'low'} onClick={() => setSegment('low')} label={`Low (${lowCount})`} color="red" />
        </div>

        {/* Department filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-3 px-3 scrollbar-none">
          {DEPARTMENTS.map(d => (
            <button
              key={d}
              onClick={() => setDeptFilter(d)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                deptFilter === d ? DEPT_COLORS[d] : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              {d === 'All' ? 'All' : d.charAt(0) + d.slice(1).toLowerCase()}
              {' '}({deptCounts[d] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-2">
        {paginated.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            {search ? 'No products match your search' : 'No products found'}
          </div>
        ) : (
          <>
            {paginated.map(item => (
              <CrewProductCard
                key={item.itemCode}
                item={item}
                promo={promoMap.get(item.itemCode)}
                onPrintLabel={() => setPrintItem(item)}
              />
            ))}

            {displayLimit < displayed.length && (
              <button
                onClick={() => setDisplayLimit(n => n + 50)}
                className="w-full py-3 text-sm font-medium text-blue-600 bg-blue-50 rounded-xl flex items-center justify-center gap-1"
              >
                <ChevronDown size={14} />
                Show more ({displayed.length - displayLimit} remaining)
              </button>
            )}
          </>
        )}
      </div>

      {/* Print label sheet */}
      {printItem && (
        <PrintLabelSheet item={printItem} onClose={() => setPrintItem(null)} />
      )}

      {/* Barcode scanner */}
      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}

function SegmentPill({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: 'amber' | 'red' }) {
  const activeColors = color === 'amber' ? 'bg-amber-100 text-amber-700 border-amber-300'
    : color === 'red' ? 'bg-red-100 text-red-700 border-red-300'
    : 'bg-blue-100 text-blue-700 border-blue-300'
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
        active ? activeColors : 'bg-white border-gray-200 text-gray-500'
      }`}
    >
      {label}
    </button>
  )
}
