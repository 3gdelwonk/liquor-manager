import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, WifiOff, TrendingUp, TrendingDown, Search, ScanBarcode, ChevronDown, ChevronUp } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  checkConnection, getSalesSummary, getDepartmentBreakdown, getTopSellers, getStockLevels,
  LIQUOR_DEPT_CODES, LIQUOR_DEPT_NAMES,
  type SalesSummary, type DepartmentBreakdown, type TopSeller, type StockItem,
} from '../lib/jarvis'
import { useProductCodeLookup } from '../lib/useProductCodes'
import BarcodeScanner from './BarcodeScanner'
import BarcodeStripe from './BarcodeStripe'
import ProductImage from './ProductImage'

type LiveTab = 'sales' | 'items' | 'stock'
type TimeMode = 'day' | 'week' | 'month'
type ItemSort = 'revenue' | 'qty' | 'profit'

const DEPT_COLORS: Record<string, string> = {
  WINE:          '#7c3aed',
  SPIRITS:       '#3b82f6',
  BEER:          '#10b981',
  LIQUEURS:      '#f59e0b',
  'LIQUOR/MISC': '#ec4899',
}
const FALLBACK_COLOR = '#94a3b8'

const CURRENT_PERIOD: Record<TimeMode, string> = { day: 'today', week: 'week', month: 'month' }
const COMPARE_PERIOD: Record<TimeMode, string> = { day: 'yesterday', week: 'lastweek', month: 'lastmonth' }
const TOP_SELLER_DAYS: Record<TimeMode, number> = { day: 1, week: 7, month: 30 }
const MODE_LABELS: Record<TimeMode, string> = { day: 'Today', week: 'This Week', month: 'This Month' }
const COMPARE_LABELS: Record<TimeMode, string> = { day: 'yesterday', week: 'last week', month: 'last month' }

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCompact(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function fmtPct(n: number | null) {
  if (n === null || isNaN(n)) return '—'
  return `${n.toFixed(1)}%`
}

function deltaColor(delta: number | null) {
  if (delta === null) return 'text-gray-400'
  return delta >= 0 ? 'text-green-600' : 'text-red-500'
}

function DeltaBadge({ current, previous, label }: { current: number; previous: number | null; label: string }) {
  if (previous === null || previous === 0) return <p className="text-xs text-gray-400">{label}</p>
  const delta = ((current - previous) / previous) * 100
  const up = delta >= 0
  return (
    <div className="flex items-center gap-1">
      <div className={`flex items-center gap-0.5 text-xs font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>
        {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
        <span>{up ? '+' : ''}{delta.toFixed(1)}%</span>
      </div>
      <span className="text-xs text-gray-400">vs {label}</span>
    </div>
  )
}

export default function LiveSalesView() {
  const [liveTab, setLiveTab] = useState<LiveTab>('sales')
  const [timeMode, setTimeMode] = useState<TimeMode>('day')
  const [itemSort, setItemSort] = useState<ItemSort>('revenue')
  const [selectedDept, setSelectedDept] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  // Current period data
  const [, setCurrentSummary] = useState<SalesSummary | null>(null)
  const [deptBreakdown, setDeptBreakdown] = useState<DepartmentBreakdown[] | null>(null)
  const [topSellers, setTopSellers] = useState<TopSeller[] | null>(null)
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null)

  // Comparison period data (best-effort)
  const [, setCompareSummary] = useState<SalesSummary | null>(null)
  const [compareDepts, setCompareDepts] = useState<DepartmentBreakdown[]>([])

  const [stockSearch, setStockSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const { getOrderCode, resolveCode } = useProductCodeLookup()

  const handleScan = useCallback((code: string) => {
    setScannerOpen(false)
    setStockSearch(resolveCode(code))
    setLiveTab('stock')
  }, [resolveCode])

  const fetchAll = useCallback(async () => {
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

      const period = CURRENT_PERIOD[timeMode]
      const days = TOP_SELLER_DAYS[timeMode]

      // Core data (always fetch)
      const [summary, depts, sellers, stock] = await Promise.all([
        getSalesSummary(period),
        getDepartmentBreakdown(period),
        getTopSellers(days, 100),
        getStockLevels(),
      ])
      setCurrentSummary(summary)
      setDeptBreakdown(depts)
      setTopSellers(sellers)
      setStockItems(stock)
      setLastFetch(new Date())

      // Comparison data (best-effort — don't fail if API doesn't support these periods)
      try {
        const comparePeriod = COMPARE_PERIOD[timeMode]
        const [cs, cd] = await Promise.all([
          getSalesSummary(comparePeriod),
          getDepartmentBreakdown(comparePeriod),
        ])
        setCompareSummary(cs)
        setCompareDepts(cd)
      } catch {
        setCompareSummary(null)
        setCompareDepts([])
      }
    } catch (err) {
      setError((err as Error).message)
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [timeMode])

  useEffect(() => {
    setDeptBreakdown(null)
    setTopSellers(null)
    setCurrentSummary(null)
    setCompareSummary(null)
    setCompareDepts([])
    setSelectedDept(null)
    fetchAll()
    const id = setInterval(fetchAll, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchAll])

  // ── Liquor-only derived data ────────────────────────────────────────────────

  const liquorDepts = useMemo(
    () => deptBreakdown ? deptBreakdown.filter(d => LIQUOR_DEPT_CODES.has(d.code) && d.sales > 0) : [],
    [deptBreakdown]
  )

  const liquorCompareDepts = useMemo(
    () => compareDepts.filter(d => LIQUOR_DEPT_CODES.has(d.code)),
    [compareDepts]
  )

  const liquorKPI = useMemo(() => {
    if (!liquorDepts.length) return null
    const revenue = liquorDepts.reduce((s, d) => s + d.sales, 0)
    const cost    = liquorDepts.reduce((s, d) => s + d.cost, 0)
    const gp      = liquorDepts.reduce((s, d) => s + d.grossProfit, 0)
    const txn     = liquorDepts.reduce((s, d) => s + d.transactions, 0)
    const promo   = liquorDepts.reduce((s, d) => s + d.promotionSales, 0)
    return {
      revenue, cost, grossProfit: gp,
      margin: revenue > 0 ? (gp / revenue) * 100 : 0,
      transactions: txn,
      promoSales: promo,
      promoPercent: revenue > 0 ? (promo / revenue) * 100 : 0,
    }
  }, [liquorDepts])

  const compareKPI = useMemo(() => {
    if (!liquorCompareDepts.length) return null
    const revenue = liquorCompareDepts.reduce((s, d) => s + d.sales, 0)
    const gp      = liquorCompareDepts.reduce((s, d) => s + d.grossProfit, 0)
    const txn     = liquorCompareDepts.reduce((s, d) => s + d.transactions, 0)
    const promo   = liquorCompareDepts.reduce((s, d) => s + d.promotionSales, 0)
    return { revenue, grossProfit: gp, transactions: txn, promoSales: promo }
  }, [liquorCompareDepts])

  const liquorSellers = useMemo(
    () => topSellers ? topSellers.filter(t => LIQUOR_DEPT_NAMES.has(t.department)) : [],
    [topSellers]
  )

  // Sorted sellers for Items tab
  const sortedSellers = useMemo(() => {
    const list = [...liquorSellers]
    switch (itemSort) {
      case 'revenue': return list.sort((a, b) => b.revenue - a.revenue)
      case 'qty': return list.sort((a, b) => b.quantitySold - a.quantitySold)
      case 'profit': return list.sort((a, b) => (b.revenue - b.cost) - (a.revenue - a.cost))
    }
  }, [liquorSellers, itemSort])

  const liquorStock = useMemo(
    () => stockItems ? stockItems.filter(s => LIQUOR_DEPT_CODES.has(s.departmentCode)) : [],
    [stockItems]
  )

  // Map itemCode → barcode from stock data
  const itemCodeToBarcode = useMemo(() => {
    const map = new Map<string, string>()
    if (stockItems) {
      for (const s of stockItems) {
        if (s.barcode) map.set(s.itemCode, s.barcode)
      }
    }
    return map
  }, [stockItems])

  const filteredStock = useMemo(
    () => stockSearch
      ? liquorStock.filter(s => {
          const q = stockSearch.toLowerCase()
          const orderCode = getOrderCode(s.barcode)
          return s.description.toLowerCase().includes(q) ||
            s.itemCode.toLowerCase().includes(q) ||
            s.department.toLowerCase().includes(q) ||
            (s.barcode && s.barcode.includes(stockSearch)) ||
            (orderCode && orderCode.toLowerCase().includes(q))
        })
      : liquorStock,
    [liquorStock, stockSearch, getOrderCode]
  )

  // Department comparison chart data
  const deptChartData = useMemo(() => {
    return liquorDepts.map(d => {
      const prev = liquorCompareDepts.find(c => c.code === d.code)
      return {
        department: d.department,
        code: d.code,
        current: d.sales,
        previous: prev?.sales ?? 0,
        currentGP: d.grossProfit,
        previousGP: prev?.grossProfit ?? 0,
      }
    })
  }, [liquorDepts, liquorCompareDepts])

  // ── Status banner ───────────────────────────────────────────────────────────

  const statusBanner = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white shrink-0">
      <div className="flex items-center gap-2">
        {connected === null ? (
          <span className="text-xs text-gray-400">Connecting…</span>
        ) : connected ? (
          <>
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
            <span className="text-xs text-green-600 font-medium">Live · JARVISmart</span>
          </>
        ) : (
          <>
            <WifiOff size={12} className="text-red-400 shrink-0" />
            <span className="text-xs text-red-500 font-medium">Offline</span>
          </>
        )}
        {lastFetch && (
          <span className="text-xs text-gray-400">
            {lastFetch.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <button
        onClick={fetchAll}
        disabled={loading}
        className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 disabled:opacity-40"
        aria-label="Refresh"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  )

  // ── Loading (first fetch) ───────────────────────────────────────────────────

  if (loading && !deptBreakdown && !stockItems) {
    return (
      <div className="flex flex-col h-full">
        {statusBanner}
        <div className="flex items-center justify-center flex-1">
          <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  // ── Offline / error ────────────────────────────────────────────────────────

  if (connected === false && !deptBreakdown) {
    return (
      <div className="flex flex-col h-full">
        {statusBanner}
        <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
          <WifiOff size={40} className="text-red-200" />
          <p className="text-sm font-medium text-red-600">Cannot reach JARVISmart</p>
          <p className="text-xs text-gray-400 max-w-xs">{error}</p>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="text-sm text-violet-600 font-medium underline disabled:opacity-50"
          >
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {statusBanner}

      {/* Time mode selector */}
      <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['day', 'week', 'month'] as TimeMode[]).map(m => (
            <button
              key={m}
              onClick={() => setTimeMode(m)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                timeMode === m ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              {m === 'day' ? 'Day' : m === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-gray-100 bg-white shrink-0">
        {(['sales', 'items', 'stock'] as LiveTab[]).map(t => (
          <button
            key={t}
            onClick={() => setLiveTab(t)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              liveTab === t ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-500'
            }`}
          >
            {t === 'sales' ? 'Sales' : t === 'items' ? 'Items' : 'Stock'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">

        {/* ── Sales tab ─────────────────────────────────────────────────────── */}
        {liveTab === 'sales' && (
          <div className="p-4 space-y-4 pb-8">

            {/* No-data empty state — data fetched but no liquor sales yet */}
            {!loading && deptBreakdown !== null && liquorDepts.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <p className="text-sm font-medium text-gray-500">No liquor sales recorded yet</p>
                <p className="text-xs text-gray-400">
                  {timeMode === 'day'
                    ? 'Sales for today will appear once the POS syncs.'
                    : `No sales data available for this ${timeMode}.`}
                </p>
              </div>
            )}

            {/* Hero KPIs */}
            {liquorKPI && (
              <div className="space-y-3">
                {/* Revenue + GP hero row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gradient-to-br from-violet-50 to-white border border-violet-100 rounded-xl p-3.5 shadow-sm">
                    <p className="text-xs text-violet-500 font-medium">Revenue</p>
                    <p className="text-xl font-bold text-gray-900 mt-0.5">${fmtMoney(liquorKPI.revenue)}</p>
                    <DeltaBadge
                      current={liquorKPI.revenue}
                      previous={compareKPI?.revenue ?? null}
                      label={COMPARE_LABELS[timeMode]}
                    />
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-white border border-green-100 rounded-xl p-3.5 shadow-sm">
                    <p className="text-xs text-green-600 font-medium">Gross Profit</p>
                    <p className="text-xl font-bold text-green-700 mt-0.5">${fmtMoney(liquorKPI.grossProfit)}</p>
                    <DeltaBadge
                      current={liquorKPI.grossProfit}
                      previous={compareKPI?.grossProfit ?? null}
                      label={COMPARE_LABELS[timeMode]}
                    />
                  </div>
                </div>

                {/* Secondary KPIs */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white border border-gray-100 rounded-lg p-2.5 shadow-sm">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Margin</p>
                    <p className="text-sm font-bold text-gray-800">{fmtPct(liquorKPI.margin)}</p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-lg p-2.5 shadow-sm">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Transactions</p>
                    <p className="text-sm font-bold text-gray-800">{liquorKPI.transactions.toLocaleString()}</p>
                    {compareKPI && (
                      <p className={`text-[10px] font-medium ${deltaColor(liquorKPI.transactions - compareKPI.transactions)}`}>
                        {liquorKPI.transactions >= compareKPI.transactions ? '+' : ''}{liquorKPI.transactions - compareKPI.transactions}
                      </p>
                    )}
                  </div>
                  <div className="bg-white border border-gray-100 rounded-lg p-2.5 shadow-sm">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Promo</p>
                    <p className="text-sm font-bold text-amber-600">${fmtCompact(liquorKPI.promoSales)}</p>
                    <p className="text-[10px] text-gray-400">{fmtPct(liquorKPI.promoPercent)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Department comparison bar chart */}
            {deptChartData.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-700">Sales by Department</h2>
                  {compareKPI && (
                    <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                      current vs {COMPARE_LABELS[timeMode]}
                    </span>
                  )}
                </div>
                <div style={{ height: Math.max(160, deptChartData.length * 48) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={deptChartData}
                      layout="vertical"
                      margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                      barGap={2}
                      barSize={12}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="department"
                        width={88}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip
                        formatter={(v: number, name: string) => [
                          `$${fmtMoney(v)}`,
                          name === 'current' ? MODE_LABELS[timeMode] : COMPARE_LABELS[timeMode],
                        ]}
                      />
                      <Bar dataKey="current" radius={[0, 4, 4, 0]} name="current">
                        {deptChartData.map(d => (
                          <Cell
                            key={d.code}
                            fill={DEPT_COLORS[d.department] ?? FALLBACK_COLOR}
                            opacity={selectedDept && selectedDept !== d.department ? 0.3 : 1}
                            cursor="pointer"
                          />
                        ))}
                      </Bar>
                      {compareKPI && (
                        <Bar dataKey="previous" radius={[0, 4, 4, 0]} name="previous">
                          {deptChartData.map(d => (
                            <Cell
                              key={d.code}
                              fill={DEPT_COLORS[d.department] ?? FALLBACK_COLOR}
                              opacity={0.25}
                            />
                          ))}
                        </Bar>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Department breakdown — tappable rows with drill-down */}
            {liquorDepts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Department Breakdown</h2>
                <div className="space-y-1">
                  {liquorDepts.map(d => {
                    const isOpen = selectedDept === d.department
                    const prev = liquorCompareDepts.find(c => c.code === d.code)
                    const delta = prev && prev.sales > 0
                      ? ((d.sales - prev.sales) / prev.sales) * 100
                      : null
                    const deptSellers = isOpen ? sortedSellers.filter(s => s.department === d.department) : []

                    return (
                      <div key={d.code} className="bg-white border border-gray-100 rounded-lg overflow-hidden shadow-sm">
                        <button
                          className="w-full text-left px-3 py-2.5 flex items-center gap-2"
                          onClick={() => setSelectedDept(isOpen ? null : d.department)}
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ background: DEPT_COLORS[d.department] ?? FALLBACK_COLOR }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{d.department}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-500">${fmtMoney(d.sales)}</span>
                              <span className="text-xs text-green-600">GP ${fmtMoney(d.grossProfit)}</span>
                              <span className="text-xs text-gray-400">{fmtPct(d.marginPercent)}</span>
                            </div>
                          </div>
                          {delta !== null && (
                            <span className={`text-xs font-medium ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                            </span>
                          )}
                          <div className="text-gray-400 shrink-0">
                            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </button>

                        {/* Drill-down: top products in this department */}
                        {isOpen && (
                          <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 space-y-0.5">
                            {deptSellers.length > 0 ? (
                              <>
                                <div className="flex items-center justify-between mb-1.5">
                                  <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
                                    Top {d.department} Products
                                  </p>
                                  <div className="flex gap-1">
                                    {(['revenue', 'qty', 'profit'] as ItemSort[]).map(s => (
                                      <button
                                        key={s}
                                        onClick={(e) => { e.stopPropagation(); setItemSort(s) }}
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                          itemSort === s ? 'bg-violet-100 text-violet-700' : 'text-gray-400'
                                        }`}
                                      >
                                        {s === 'revenue' ? 'Rev' : s === 'qty' ? 'Qty' : 'GP'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                {deptSellers.slice(0, 10).map((item, i) => {
                                  const barcode = itemCodeToBarcode.get(item.itemCode) ?? null
                                  const orderCode = getOrderCode(barcode)
                                  const gp = item.revenue - item.cost
                                  return (
                                    <div key={item.itemCode} className="flex items-center gap-2 py-1.5">
                                      <span className="text-[10px] text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                                      <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={barcode} size={32} />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs text-gray-800 truncate">{item.description}</p>
                                        <div className="flex items-center gap-1 mt-0.5">
                                          {orderCode && <span className="text-[10px] text-gray-400 font-mono">#{orderCode}</span>}
                                          <span className="text-[10px] text-gray-300 font-mono">{item.itemCode}</span>
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0">
                                        {itemSort === 'qty' ? (
                                          <>
                                            <p className="text-xs font-semibold text-gray-700">{item.quantitySold} sold</p>
                                            <p className="text-[10px] text-gray-400">${fmtMoney(item.revenue)}</p>
                                          </>
                                        ) : itemSort === 'profit' ? (
                                          <>
                                            <p className="text-xs font-semibold text-green-700">${fmtMoney(gp)}</p>
                                            <p className="text-[10px] text-gray-400">{item.revenue > 0 ? fmtPct((gp / item.revenue) * 100) : '—'} margin</p>
                                          </>
                                        ) : (
                                          <>
                                            <p className="text-xs font-semibold text-gray-700">${fmtMoney(item.revenue)}</p>
                                            <p className="text-[10px] text-gray-400">{item.quantitySold} sold</p>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                                {deptSellers.length > 10 && (
                                  <p className="text-[10px] text-gray-400 text-center pt-1">
                                    +{deptSellers.length - 10} more items
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-gray-400 py-2 text-center">No item data for this period</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Comparison summary table */}
            {liquorKPI && compareKPI && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">
                  {MODE_LABELS[timeMode]} vs {COMPARE_LABELS[timeMode]}
                </h2>
                <div className="overflow-x-auto -mx-4">
                  <table className="w-full text-xs min-w-[320px]">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="py-2 px-4 text-left font-medium">Metric</th>
                        <th className="py-2 px-2 text-right font-medium">{MODE_LABELS[timeMode]}</th>
                        <th className="py-2 px-2 text-right font-medium capitalize">{COMPARE_LABELS[timeMode]}</th>
                        <th className="py-2 px-3 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Revenue', curr: liquorKPI.revenue, prev: compareKPI.revenue, isMoney: true },
                        { label: 'Gross Profit', curr: liquorKPI.grossProfit, prev: compareKPI.grossProfit, isMoney: true },
                        { label: 'Transactions', curr: liquorKPI.transactions, prev: compareKPI.transactions, isMoney: false },
                        { label: 'Promo Sales', curr: liquorKPI.promoSales, prev: compareKPI.promoSales, isMoney: true },
                      ].map(row => {
                        const delta = row.prev > 0 ? ((row.curr - row.prev) / row.prev) * 100 : null
                        return (
                          <tr key={row.label} className="border-b border-gray-50">
                            <td className="py-2 px-4 font-medium text-gray-700">{row.label}</td>
                            <td className="py-2 px-2 text-right font-mono">
                              {row.isMoney ? `$${fmtMoney(row.curr)}` : row.curr.toLocaleString()}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-gray-400">
                              {row.isMoney ? `$${fmtMoney(row.prev)}` : row.prev.toLocaleString()}
                            </td>
                            <td className={`py-2 px-3 text-right font-medium ${deltaColor(delta)}`}>
                              {delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!liquorKPI && !loading && (
              <p className="text-center text-sm text-gray-400 py-8">No liquor sales data</p>
            )}
          </div>
        )}

        {/* ── Items tab ─────────────────────────────────────────────────────── */}
        {liveTab === 'items' && (
          <div className="p-4 pb-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <TrendingUp size={12} />
                <span>
                  Top liquor sellers — {MODE_LABELS[timeMode].toLowerCase()}
                  {sortedSellers.length > 0 && ` · ${sortedSellers.length} items`}
                </span>
              </div>
              {/* Sort toggle */}
              <div className="flex gap-1">
                {(['revenue', 'qty', 'profit'] as ItemSort[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setItemSort(s)}
                    className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
                      itemSort === s ? 'bg-violet-100 text-violet-700' : 'bg-gray-50 text-gray-400'
                    }`}
                  >
                    {s === 'revenue' ? 'Revenue' : s === 'qty' ? 'Qty Sold' : 'Profit'}
                  </button>
                ))}
              </div>
            </div>
            {sortedSellers.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {sortedSellers.map((item, i) => {
                  const barcode = itemCodeToBarcode.get(item.itemCode) ?? null
                  const orderCode = getOrderCode(barcode)
                  const gp = item.revenue - item.cost
                  return (
                    <div key={item.itemCode} className="py-2.5 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-6 text-right shrink-0">{i + 1}</span>
                        <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={barcode} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{item.description}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {orderCode && <span className="text-[10px] text-gray-400 font-mono">#{orderCode}</span>}
                            <span className="text-[10px] text-gray-300 font-mono">{item.itemCode}</span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{
                                backgroundColor: (DEPT_COLORS[item.department] ?? FALLBACK_COLOR) + '18',
                                color: DEPT_COLORS[item.department] ?? FALLBACK_COLOR,
                              }}
                            >
                              {item.department}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {itemSort === 'qty' ? (
                            <>
                              <p className="text-xs font-semibold text-gray-700">{item.quantitySold} sold</p>
                              <p className="text-xs text-gray-400">${fmtMoney(item.revenue)}</p>
                            </>
                          ) : itemSort === 'profit' ? (
                            <>
                              <p className="text-xs font-semibold text-green-700">${fmtMoney(gp)}</p>
                              <p className="text-xs text-gray-400">{item.revenue > 0 ? fmtPct((gp / item.revenue) * 100) : '—'} margin</p>
                            </>
                          ) : (
                            <>
                              <p className="text-xs font-semibold text-gray-700">${fmtMoney(item.revenue)}</p>
                              <p className="text-xs text-gray-400">{item.quantitySold} sold</p>
                            </>
                          )}
                          {item.quantitySold > 0 && (
                            <p className="text-[10px] text-violet-500 mt-0.5">${fmtMoney(item.revenue / item.quantitySold)}/ea</p>
                          )}
                        </div>
                      </div>
                      {barcode && <div className="ml-9 mr-2"><BarcodeStripe value={barcode} height={32} /></div>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400 py-8">
                {loading ? 'Loading…' : 'No liquor items sold yet'}
              </p>
            )}
          </div>
        )}

        {/* ── Stock / QOH tab ───────────────────────────────────────────────── */}
        {liveTab === 'stock' && (
          <div className="p-4 pb-8 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  placeholder="Search name, barcode, order code…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <button
                onClick={() => setScannerOpen(true)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
                title="Scan barcode or code"
              >
                <ScanBarcode size={18} />
              </button>
            </div>
            {liquorStock.length > 0 && (
              <p className="text-xs text-gray-400">
                {filteredStock.length} of {liquorStock.length} liquor items · live QOH
              </p>
            )}
            {filteredStock.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {filteredStock.map(item => {
                  const low = item.onHand < item.reorderLevel
                  const negative = item.onHand < 0
                  const orderCode = getOrderCode(item.barcode)
                  return (
                    <div key={item.itemCode} className="py-3 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{item.description}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {orderCode && <span className="text-[10px] text-gray-400 font-mono">#{orderCode}</span>}
                            <span className="text-[10px] text-gray-300 font-mono">{item.itemCode}</span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{
                                backgroundColor: (DEPT_COLORS[item.department] ?? FALLBACK_COLOR) + '18',
                                color: DEPT_COLORS[item.department] ?? FALLBACK_COLOR,
                              }}
                            >
                              {item.department}
                            </span>
                            {item.onOrder > 0 && (
                              <span className="text-xs text-blue-500">+{item.onOrder} on order</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold text-gray-700">${fmtMoney(item.sellPrice)}</p>
                          <p className={`text-sm font-bold ${negative ? 'text-red-600' : low ? 'text-amber-600' : 'text-gray-800'}`}>
                            {item.onHand}
                          </p>
                          <p className={`text-xs ${negative ? 'text-red-400' : low ? 'text-amber-400' : 'text-gray-400'}`}>
                            {negative ? 'Negative' : low ? `min ${item.reorderLevel}` : 'QOH'}
                          </p>
                        </div>
                      </div>
                      {item.barcode && <div className="ml-12"><BarcodeStripe value={item.barcode} height={32} /></div>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400 py-8">
                {loading ? 'Loading…' : stockSearch ? 'No matches' : 'No liquor stock data'}
              </p>
            )}
          </div>
        )}

      </div>
      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
