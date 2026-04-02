import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, WifiOff, TrendingUp, Search, ScanBarcode } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  checkConnection, getDepartmentBreakdown, getTopSellers, getStockLevels,
  LIQUOR_DEPT_CODES, LIQUOR_DEPT_NAMES,
  type DepartmentBreakdown, type TopSeller, type StockItem,
} from '../lib/jarvis'
import { useProductCodeLookup } from '../lib/useProductCodes'
import BarcodeScanner from './BarcodeScanner'

type LiveTab = 'sales' | 'items' | 'stock'
type Period = 'today' | 'week'

const DEPT_COLORS: Record<string, string> = {
  WINE:          '#7c3aed',
  SPIRITS:       '#3b82f6',
  BEER:          '#10b981',
  LIQUEURS:      '#f59e0b',
  'LIQUOR/MISC': '#ec4899',
}
const FALLBACK_COLOR = '#94a3b8'

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number | null) {
  if (n === null || isNaN(n)) return '—'
  return `${n.toFixed(1)}%`
}

export default function LiveSalesView() {
  const [liveTab, setLiveTab] = useState<LiveTab>('sales')
  const [period, setPeriod] = useState<Period>('today')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const [deptBreakdown, setDeptBreakdown] = useState<DepartmentBreakdown[] | null>(null)
  const [topSellers, setTopSellers] = useState<TopSeller[] | null>(null)
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null)
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
      const days = period === 'today' ? 1 : 7
      const [depts, sellers, stock] = await Promise.all([
        getDepartmentBreakdown(period),
        getTopSellers(days, 100),
        getStockLevels(),
      ])
      setDeptBreakdown(depts)
      setTopSellers(sellers)
      setStockItems(stock)
      setLastFetch(new Date())
    } catch (err) {
      setError((err as Error).message)
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    setDeptBreakdown(null)
    setTopSellers(null)
    fetchAll()
    const id = setInterval(fetchAll, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchAll])

  // ── Liquor-only derived data ────────────────────────────────────────────────

  const liquorDepts = useMemo(
    () => deptBreakdown ? deptBreakdown.filter(d => LIQUOR_DEPT_CODES.has(d.code) && d.sales > 0) : [],
    [deptBreakdown]
  )

  const liquorKPI = useMemo(() => {
    if (!liquorDepts.length) return null
    const revenue = liquorDepts.reduce((s, d) => s + d.sales, 0)
    const gp      = liquorDepts.reduce((s, d) => s + d.grossProfit, 0)
    const txn     = liquorDepts.reduce((s, d) => s + d.transactions, 0)
    const promo   = liquorDepts.reduce((s, d) => s + d.promotionSales, 0)
    return {
      revenue,
      grossProfit: gp,
      margin: revenue > 0 ? (gp / revenue) * 100 : 0,
      transactions: txn,
      promoSales: promo,
      promoPercent: revenue > 0 ? (promo / revenue) * 100 : 0,
    }
  }, [liquorDepts])

  const liquorSellers = useMemo(
    () => topSellers ? topSellers.filter(t => LIQUOR_DEPT_NAMES.has(t.department)) : [],
    [topSellers]
  )

  const liquorStock = useMemo(
    () => stockItems ? stockItems.filter(s => LIQUOR_DEPT_CODES.has(s.departmentCode)) : [],
    [stockItems]
  )

  // Map itemCode → barcode from stock data (for cross-referencing top sellers with order codes)
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

      {/* Period toggle */}
      <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['today', 'week'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 text-xs font-medium py-1 rounded-md transition-colors ${
                period === p ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              {p === 'today' ? 'Today' : 'This Week'}
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
          <div className="p-4 space-y-5 pb-8">

            {/* Liquor KPI grid */}
            {liquorKPI && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  <p className="text-xs text-gray-500">Liquor Revenue</p>
                  <p className="text-base font-bold text-gray-900">${fmtMoney(liquorKPI.revenue)}</p>
                  <p className="text-xs text-gray-400">{period === 'today' ? 'Today' : 'This week'}</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  <p className="text-xs text-gray-500">Gross Profit</p>
                  <p className="text-base font-bold text-green-700">${fmtMoney(liquorKPI.grossProfit)}</p>
                  <p className="text-xs text-gray-400">{fmtPct(liquorKPI.margin)} margin</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  <p className="text-xs text-gray-500">Transactions</p>
                  <p className="text-base font-bold text-gray-900">{liquorKPI.transactions.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{liquorDepts.length} departments</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  <p className="text-xs text-gray-500">Promo Sales</p>
                  <p className="text-base font-bold text-amber-600">${fmtMoney(liquorKPI.promoSales)}</p>
                  <p className="text-xs text-gray-400">{fmtPct(liquorKPI.promoPercent)} of revenue</p>
                </div>
              </div>
            )}

            {/* Department bar chart */}
            {liquorDepts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Sales by Category</h2>
                <div style={{ height: Math.max(140, liquorDepts.length * 36) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={liquorDepts}
                      layout="vertical"
                      margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="department"
                        width={96}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(v: number) => [`$${fmtMoney(v)}`, 'Sales']} />
                      <Bar dataKey="sales" radius={[0, 6, 6, 0]}>
                        {liquorDepts.map(d => (
                          <Cell key={d.code} fill={DEPT_COLORS[d.department] ?? FALLBACK_COLOR} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Department table */}
            {liquorDepts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Category Breakdown</h2>
                <div className="overflow-x-auto -mx-4">
                  <table className="w-full text-xs min-w-[340px]">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="py-2 px-4 text-left font-medium">Category</th>
                        <th className="py-2 px-2 text-right font-medium">Sales</th>
                        <th className="py-2 px-2 text-right font-medium">GP</th>
                        <th className="py-2 px-3 text-right font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liquorDepts.map(d => (
                        <tr key={d.code} className="border-b border-gray-50">
                          <td className="py-2 px-4">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ background: DEPT_COLORS[d.department] ?? FALLBACK_COLOR }}
                              />
                              {d.department}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono">${fmtMoney(d.sales)}</td>
                          <td className="py-2 px-2 text-right font-mono text-green-700">${fmtMoney(d.grossProfit)}</td>
                          <td className="py-2 px-3 text-right">{fmtPct(d.marginPercent)}</td>
                        </tr>
                      ))}
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
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-3">
              <TrendingUp size={12} />
              <span>
                Top liquor sellers — {period === 'today' ? 'today' : 'last 7 days'}
                {liquorSellers.length > 0 && ` · ${liquorSellers.length} items`}
              </span>
            </div>
            {liquorSellers.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {liquorSellers.map((item, i) => (
                  <div key={item.itemCode} className="flex items-center gap-3 py-2.5">
                    <span className="text-xs text-gray-400 w-6 text-right shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{item.description}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {(() => { const oc = getOrderCode(itemCodeToBarcode.get(item.itemCode) ?? null); return oc ? <span className="text-[10px] text-gray-400 font-mono">#{oc}</span> : null })()}
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
                      <p className="text-xs font-semibold text-gray-700">{item.quantitySold} sold</p>
                      <p className="text-xs text-gray-400">${fmtMoney(item.revenue)}</p>
                    </div>
                  </div>
                ))}
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
                  return (
                    <div key={item.itemCode} className="flex items-center gap-3 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{item.description}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {(() => { const oc = getOrderCode(item.barcode); return oc ? <span className="text-[10px] text-gray-400 font-mono">#{oc}</span> : null })()}
                          {item.barcode && <span className="text-[10px] text-gray-300 font-mono">{item.barcode}</span>}
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
                        <p className={`text-sm font-bold ${negative ? 'text-red-600' : low ? 'text-amber-600' : 'text-gray-800'}`}>
                          {item.onHand}
                        </p>
                        <p className={`text-xs ${negative ? 'text-red-400' : low ? 'text-amber-400' : 'text-gray-400'}`}>
                          {negative ? 'Negative' : low ? `⚠ min ${item.reorderLevel}` : 'QOH'}
                        </p>
                      </div>
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
