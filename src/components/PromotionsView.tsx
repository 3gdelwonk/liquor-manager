import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, WifiOff, Tag, AlertTriangle } from 'lucide-react'
import {
  checkConnection, getPromotions, LIQUOR_DEPT_NAMES,
  type LivePromotion,
} from '../lib/jarvis'

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

function PromoCard({ promo }: { promo: LivePromotion }) {
  const badgeClass = DEPT_COLORS[promo.department] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-gray-800 truncate">{promo.description}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badgeClass}`}>
              {promo.department}
            </span>
          </div>

          {/* Pricing */}
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-sm font-semibold text-gray-900">${fmtMoney(promo.promoPrice)}</span>
            <span className="text-xs text-gray-400 line-through">${fmtMoney(promo.normalPrice)}</span>
            {promo.discountPercent > 0 && (
              <span className="text-xs font-medium text-green-600">{promo.discountPercent.toFixed(0)}% off</span>
            )}
          </div>

          {/* Details row */}
          <div className="flex items-center gap-3 mt-1 text-xs">
            <span className={`font-medium ${marginColor(promo.marginPercent)}`}>
              {promo.marginPercent.toFixed(1)}% margin
            </span>
            <span className={`font-medium ${daysLeftColor(promo.daysLeft)}`}>
              {promo.daysLeft === 0 ? 'Last day' : promo.daysLeft === 1 ? '1 day left' : `${promo.daysLeft} days left`}
            </span>
          </div>

          {/* Cost details */}
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
            {promo.promoUnitCost !== null && (
              <span>Unit: ${fmtMoney(promo.promoUnitCost)} / ${fmtMoney(promo.normalUnitCost)}</span>
            )}
            {promo.costSavingPercent !== null && promo.costSavingPercent > 0 && (
              <span className="text-blue-500">{promo.costSavingPercent.toFixed(1)}% CTN saving</span>
            )}
          </div>
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
  const [totalCount, setTotalCount] = useState(0)
  const [expiringSoon, setExpiringSoon] = useState(0)

  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('discount')

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
      const data = await getPromotions()
      // Filter to liquor departments only
      const liquorPromos = data.items.filter(p => LIQUOR_DEPT_NAMES.has(p.department))
      setAllPromos(liquorPromos)
      setTotalCount(liquorPromos.length)
      setExpiringSoon(liquorPromos.filter(p => p.daysLeft <= 2).length)
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

  // Filter + sort
  const displayed = useMemo(() => {
    if (!allPromos) return []
    let list = deptFilter === 'all' ? allPromos : allPromos.filter(p => p.department === deptFilter)
    list = [...list].sort((a, b) => {
      if (sortKey === 'discount') return b.discountPercent - a.discountPercent
      if (sortKey === 'daysLeft') return a.daysLeft - b.daysLeft
      return b.marginPercent - a.marginPercent
    })
    return list
  }, [allPromos, deptFilter, sortKey])

  // Count per dept for filter badges
  const deptCounts = useMemo(() => {
    if (!allPromos) return {} as Record<string, number>
    const counts: Record<string, number> = {}
    for (const p of allPromos) {
      counts[p.department] = (counts[p.department] ?? 0) + 1
    }
    return counts
  }, [allPromos])

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
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Tag size={14} className="text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">{totalCount}</span>
            <span className="text-xs text-gray-400">liquor promos</span>
          </div>
          {expiringSoon > 0 && (
            <div className="flex items-center gap-1">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="text-xs text-amber-600 font-medium">{expiringSoon} expiring soon</span>
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

      {/* Department filters */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-gray-100 overflow-x-auto">
        {DEPT_FILTERS.map(f => {
          const count = f.key === 'all' ? totalCount : (deptCounts[f.key] ?? 0)
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
          { key: 'daysLeft' as SortKey, label: 'Ending soon' },
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
            <p className="text-sm text-gray-400">No liquor promotions{deptFilter !== 'all' ? ` in ${deptFilter}` : ''}</p>
          </div>
        )}
        {displayed.map(p => (
          <PromoCard key={p.itemCode} promo={p} />
        ))}
      </div>
    </div>
  )
}
