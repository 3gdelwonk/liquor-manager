import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, WifiOff, Tag, Search, ScanBarcode, X, AlertTriangle, Calendar } from 'lucide-react'
import { checkConnection, getPromotions, getStockLevels, type LivePromotion } from '../lib/jarvis'
import { useTrackedItemCodes } from '../lib/useTrackedItems'
import BarcodeScanner from './BarcodeScanner'
import ProductImage from './ProductImage'

type Segment = 'active' | 'upcoming'
type DeptFilter = 'all' | 'WINE' | 'BEER' | 'SPIRITS' | 'LIQUEURS' | 'LIQUOR/MISC'
type SortKey = 'discount' | 'daysLeft' | 'margin'

const DEPT_COLORS: Record<string, string> = {
  WINE:          'bg-violet-100 text-violet-700',
  SPIRITS:       'bg-blue-100 text-blue-700',
  BEER:          'bg-emerald-100 text-emerald-700',
  LIQUEURS:      'bg-amber-100 text-amber-700',
  'LIQUOR/MISC': 'bg-pink-100 text-pink-700',
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function fmtDateFull(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysLeftColor(d: number) {
  if (d <= 2) return 'text-red-600'
  if (d <= 5) return 'text-amber-600'
  return 'text-green-600'
}

function marginColor(m: number) {
  if (m < 0) return 'text-red-600'
  if (m < 15) return 'text-amber-600'
  return 'text-green-600'
}

function PromoCard({ promo, isUpcoming, isTracked }: { promo: LivePromotion; isUpcoming: boolean; isTracked?: boolean }) {
  const badgeClass = DEPT_COLORS[promo.department] ?? 'bg-gray-100 text-gray-600'

  const daysUntilStart = isUpcoming
    ? Math.ceil((new Date(promo.startDate).getTime() - Date.now()) / 86400000)
    : 0

  return (
    <div className="border border-gray-100 rounded-xl p-3 flex gap-3">
      <ProductImage itemCode={promo.itemCode} description={promo.description} department={promo.department} size={56} />
      <div className="flex-1 min-w-0 space-y-1.5">
      {/* Header: name + dept badge */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">{promo.description}</p>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badgeClass}`}>
          {promo.department}
        </span>
        {isTracked && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-cyan-100 text-cyan-700">TRACKING</span>}
      </div>

      {/* Codes */}
      <div className="flex items-center gap-2 text-[10px] text-gray-400">
        <span className="font-mono">{promo.itemCode}</span>
      </div>

      {/* SELL row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-green-600 w-8 shrink-0">SELL</span>
        <span className="text-sm font-semibold text-gray-900">${fmtMoney(promo.promoPrice)}</span>
        <span className="text-xs text-gray-400 line-through">${fmtMoney(promo.normalPrice)}</span>
        {promo.discountPercent > 0 && (
          <span className="text-xs font-medium text-green-600">{promo.discountPercent.toFixed(0)}% off</span>
        )}
      </div>

      {/* COST row */}
      {promo.promoUnitCost !== null && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-blue-500 w-8 shrink-0">COST</span>
          <span className="text-sm font-medium text-gray-700">${fmtMoney(promo.promoUnitCost)}</span>
          <span className="text-xs text-gray-400 line-through">${fmtMoney(promo.normalUnitCost)}</span>
          {promo.costSavingPercent !== null && promo.costSavingPercent > 0 && (
            <span className="text-xs text-blue-500">{promo.costSavingPercent.toFixed(1)}% CTN saving</span>
          )}
        </div>
      )}

      {/* Margin + days row */}
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-medium ${marginColor(promo.marginPercent)}`}>
            {promo.marginPercent.toFixed(1)}% margin
          </span>
          {isUpcoming ? (
            <span className="font-medium text-blue-600">
              Starts in {daysUntilStart} day{daysUntilStart !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className={`font-medium ${daysLeftColor(promo.daysLeft)}`}>
              {promo.daysLeft === 0 ? 'Last day' : promo.daysLeft === 1 ? '1 day left' : `${promo.daysLeft} days left`}
            </span>
          )}
        </div>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1 text-[11px] text-gray-400">
        <Calendar size={10} />
        <span>{fmtDate(promo.startDate)} → {fmtDateFull(promo.endDate)}</span>
      </div>
      </div>
    </div>
  )
}

export default function PromotionsView() {
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [allPromos, setAllPromos] = useState<LivePromotion[] | null>(null)
  const [barcodeMap, setBarcodeMap] = useState<Map<string, string>>(new Map()) // barcode → itemCode

  const trackedItemCodes = useTrackedItemCodes()
  const [segment, setSegment] = useState<Segment>('active')
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('discount')
  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)

  const fetchPromos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await checkConnection()
      setConnected(status.connected)
      if (!status.connected) {
        setError(status.reason ?? 'Cannot reach JARVISmart')
        setLoading(false)
        return
      }
      const [data, stock] = await Promise.all([
        getPromotions(),
        getStockLevels(),
      ])
      setAllPromos(data.items)
      // Build barcode → itemCode map from stock data
      const map = new Map<string, string>()
      for (const s of stock) {
        if (s.barcode) map.set(s.barcode, s.itemCode)
      }
      setBarcodeMap(map)
      setLastFetch(new Date())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPromos()
    const iv = setInterval(fetchPromos, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [fetchPromos])

  // Split into active / upcoming
  const today = new Date().toISOString().slice(0, 10)
  const { active, upcoming } = useMemo(() => {
    if (!allPromos) return { active: [] as LivePromotion[], upcoming: [] as LivePromotion[] }
    return {
      active: allPromos.filter(p => p.startDate.slice(0, 10) <= today),
      upcoming: allPromos.filter(p => p.startDate.slice(0, 10) > today),
    }
  }, [allPromos, today])

  const segmentData = segment === 'active' ? active : upcoming

  // Apply search + dept filter + sort to current segment
  const displayed = useMemo(() => {
    let list = segmentData

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(p =>
        p.description.toLowerCase().includes(q) ||
        p.itemCode.toLowerCase().includes(q)
      )
    }

    // Department filter
    if (deptFilter !== 'all') {
      list = list.filter(p => p.department === deptFilter)
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortKey === 'discount') return b.discountPercent - a.discountPercent
      if (sortKey === 'daysLeft') return a.daysLeft - b.daysLeft
      return b.marginPercent - a.marginPercent
    })

    return list
  }, [segmentData, search, deptFilter, sortKey])

  // Dept counts from CURRENT segment (not all promos)
  const deptCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    let filtered = segmentData
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter(p =>
        p.description.toLowerCase().includes(q) ||
        p.itemCode.toLowerCase().includes(q)
      )
    }
    for (const p of filtered) {
      counts[p.department] = (counts[p.department] ?? 0) + 1
    }
    return counts
  }, [segmentData, search])

  const totalFiltered = Object.values(deptCounts).reduce((s, c) => s + c, 0)

  // Group upcoming by start date for date headers
  const upcomingGroups = useMemo(() => {
    if (segment !== 'upcoming') return []
    const groups = new Map<string, LivePromotion[]>()
    for (const p of displayed) {
      const dateKey = p.startDate.slice(0, 10)
      if (!groups.has(dateKey)) groups.set(dateKey, [])
      groups.get(dateKey)!.push(p)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [segment, displayed])

  // Handle barcode scan — resolve EAN to itemCode for matching
  const handleScan = useCallback((code: string) => {
    setScannerOpen(false)
    const itemCode = barcodeMap.get(code)
    setSearch(itemCode ?? code)
  }, [barcodeMap])

  // Expiring soon count from active
  const expiringSoon = useMemo(() => active.filter(p => p.daysLeft <= 2).length, [active])

  // ── Not connected / error ──────────────────────────────────────────────────
  if (connected === false || (error && !allPromos)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <WifiOff size={32} className="text-gray-300" />
        <p className="text-sm font-medium text-gray-500">Cannot reach JARVISmart</p>
        {error && <p className="text-xs text-gray-400">{error}</p>}
        <button onClick={fetchPromos} className="text-sm text-violet-600 underline">Retry</button>
      </div>
    )
  }

  // ── Loading (first load) ───────────────────────────────────────────────────
  if (!allPromos && loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <RefreshCw size={24} className="text-violet-400 animate-spin" />
        <p className="text-sm text-gray-400">Loading promotions...</p>
      </div>
    )
  }

  const DEPT_FILTERS: { key: DeptFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'WINE', label: 'Wine' },
    { key: 'BEER', label: 'Beer' },
    { key: 'SPIRITS', label: 'Spirits' },
    { key: 'LIQUEURS', label: 'Liqueurs' },
    { key: 'LIQUOR/MISC', label: 'Misc' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Tag size={14} className="text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">{allPromos?.length ?? 0}</span>
            <span className="text-xs text-gray-400">liquor promos</span>
          </div>
          {expiringSoon > 0 && (
            <div className="flex items-center gap-1">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="text-xs text-amber-600 font-medium">{expiringSoon} expiring</span>
            </div>
          )}
        </div>
        <button
          onClick={fetchPromos}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-violet-600 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {lastFetch && <span>{lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        </button>
      </div>

      {/* Active / Upcoming segment tabs */}
      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setSegment('active')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${segment === 'active' ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'}`}
        >
          Active ({active.length})
        </button>
        <button
          onClick={() => setSegment('upcoming')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${segment === 'upcoming' ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'}`}
        >
          Upcoming ({upcoming.length})
        </button>
      </div>

      {/* Search bar + barcode */}
      <div className="flex gap-2 px-4 py-2 border-b border-gray-100">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or code..."
            className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setScannerOpen(true)}
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:text-violet-600 hover:border-violet-300"
          title="Scan barcode"
        >
          <ScanBarcode size={18} />
        </button>
      </div>

      {/* Department filters */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-gray-100 overflow-x-auto">
        {DEPT_FILTERS.map(f => {
          const count = f.key === 'all' ? totalFiltered : (deptCounts[f.key] ?? 0)
          const isActive = deptFilter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setDeptFilter(f.key)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {f.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100">
        <span className="text-xs text-gray-400">Sort:</span>
        {([
          { key: 'discount' as SortKey, label: 'Discount' },
          { key: 'daysLeft' as SortKey, label: segment === 'active' ? 'Ending soon' : 'Starting soon' },
          { key: 'margin' as SortKey, label: 'Margin' },
        ]).map(s => (
          <button
            key={s.key}
            onClick={() => setSortKey(s.key)}
            className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
              sortKey === s.key ? 'text-violet-600 bg-violet-50' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Promo list */}
      <div className="flex-1 overflow-auto p-4 space-y-2 pb-8">
        {displayed.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Tag size={32} className="text-gray-200" />
            <p className="text-sm text-gray-400">
              {search ? `No results for "${search}"` : `No ${segment} promotions${deptFilter !== 'all' ? ` in ${deptFilter}` : ''}`}
            </p>
          </div>
        )}

        {/* Upcoming: group by start date */}
        {segment === 'upcoming' && upcomingGroups.length > 0 ? (
          upcomingGroups.map(([dateKey, items]) => (
            <div key={dateKey}>
              <div className="flex items-center gap-2 py-2">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium text-gray-500 shrink-0">
                  Starting {fmtDateFull(dateKey)} ({items.length})
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-2">
                {items.map(p => (
                  <PromoCard key={p.itemCode} promo={p} isUpcoming isTracked={trackedItemCodes.has(p.itemCode)} />
                ))}
              </div>
            </div>
          ))
        ) : (
          displayed.map(p => (
            <PromoCard key={p.itemCode} promo={p} isUpcoming={false} isTracked={trackedItemCodes.has(p.itemCode)} />
          ))
        )}
      </div>

      {/* Barcode scanner modal */}
      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
