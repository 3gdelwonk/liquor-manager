import { useState, useEffect, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Search, ArrowLeft, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle, ScanBarcode } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'
import { db, type TrackedItem } from '../lib/db'
import { searchItems, getItemPrice, getPriceHistory, getItemSales } from '../lib/jarvis'
import type { PriceCheck, PriceHistoryEntry, ItemSalesData, DailySale } from '../lib/jarvis'
import ProductImage from './ProductImage'
import BarcodeScanner from './BarcodeScanner'

// ── Add Item Sheet ──────────────────────────────────────────────────────────

function AddItemSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ itemCode: string; barcode: string | null; description: string; department: string; sellPrice: number }[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<typeof results[0] | null>(null)
  const [newPrice, setNewPrice] = useState('')
  const [changeDate, setChangeDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await searchItems(query, 10)
      setResults(res.items.map(i => ({
        itemCode: i.itemCode,
        barcode: i.barcode,
        description: i.description,
        department: i.department,
        sellPrice: i.sellPrice,
      })))
    } catch { setResults([]) }
    setSearching(false)
  }

  function handleScan(code: string) {
    setScannerOpen(false)
    setQuery(code)
    // Auto-search after scan
    setTimeout(() => {
      setQuery(code)
      searchItems(code, 10).then(res => {
        const mapped = res.items.map(i => ({
          itemCode: i.itemCode, barcode: i.barcode, description: i.description,
          department: i.department, sellPrice: i.sellPrice,
        }))
        setResults(mapped)
        if (mapped.length === 1) setSelected(mapped[0])
      }).catch(() => {})
    }, 100)
  }

  async function handleSave() {
    if (!selected || !newPrice) return
    setSaving(true)
    await db.trackedItems.add({
      itemCode: selected.itemCode,
      barcode: selected.barcode,
      description: selected.description,
      department: selected.department,
      originalPrice: selected.sellPrice,
      newPrice: parseFloat(newPrice),
      changeDate,
      notes,
      status: 'active',
      currentPrice: null,
      revertedAt: null,
      createdAt: new Date(),
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-5 space-y-4 pb-safe max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Track Price Change</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {!selected ? (
          <>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search product or barcode..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <button onClick={() => setScannerOpen(true)} className="p-2 border border-gray-200 rounded-lg text-gray-500">
                <ScanBarcode size={18} />
              </button>
              <button onClick={handleSearch} disabled={searching} className="px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg">
                {searching ? '...' : 'Search'}
              </button>
            </div>

            <div className="space-y-1 max-h-60 overflow-auto">
              {results.map(item => (
                <button
                  key={item.itemCode}
                  onClick={() => { setSelected(item); setNewPrice('') }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 text-left"
                >
                  <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
                    <p className="text-xs text-gray-400">{item.department} &middot; ${item.sellPrice.toFixed(2)}</p>
                  </div>
                </button>
              ))}
              {results.length === 0 && query && !searching && (
                <p className="text-xs text-gray-400 text-center py-4">No results found</p>
              )}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setSelected(null)} className="text-xs text-violet-600 flex items-center gap-1">
              <ArrowLeft size={12} /> Change selection
            </button>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <ProductImage itemCode={selected.itemCode} description={selected.description} department={selected.department} barcode={selected.barcode} size={40} />
              <div>
                <p className="text-sm font-medium text-gray-900">{selected.description}</p>
                <p className="text-xs text-gray-400">Current: ${selected.sellPrice.toFixed(2)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">New Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Change Date</label>
                <input
                  type="date"
                  value={changeDate}
                  onChange={e => setChangeDate(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Reason for price change..."
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={!newPrice || saving}
              className="w-full py-2.5 bg-violet-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Start Tracking'}
            </button>
          </>
        )}
      </div>
      {scannerOpen && <BarcodeScanner open onScan={handleScan} onClose={() => setScannerOpen(false)} />}
    </div>
  )
}

// ── Status helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status, revertedAt }: { status: TrackedItem['status']; revertedAt: string | null }) {
  if (status === 'reverted') return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
      <XCircle size={10} /> Reverted{revertedAt ? ` ${fmtDate(revertedAt)}` : ''}
    </span>
  )
  if (status === 'completed') return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
      <CheckCircle size={10} /> Done
    </span>
  )
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">
      <CheckCircle size={10} /> Active
    </span>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function fmtPrice(n: number): string {
  return '$' + n.toFixed(2)
}

// ── Detail View ─────────────────────────────────────────────────────────────

function TrackingDetail({ item, onBack, onUpdate }: {
  item: TrackedItem
  onBack: () => void
  onUpdate: () => void
}) {
  const [priceCheck, setPriceCheck] = useState<PriceCheck | null>(null)
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([])
  const [salesData, setSalesData] = useState<ItemSalesData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [price, history, sales] = await Promise.all([
          getItemPrice(item.itemCode).catch(() => null),
          getPriceHistory(item.itemCode, 6).catch(() => []),
          getItemSales(item.itemCode, 90).catch(() => null),
        ])
        if (cancelled) return
        setPriceCheck(price)
        setPriceHistory(history)
        setSalesData(sales)

        // Auto-detect reversion
        if (price && item.status === 'active') {
          const currentPrice = price.RegSellPrice
          const priceHeld = Math.abs(currentPrice - item.newPrice) < 0.01
          if (!priceHeld) {
            // Check if host changed it
            const hostChange = history.find(h =>
              h.changedBy === 'host' && new Date(h.date) >= new Date(item.changeDate)
            )
            if (hostChange) {
              await db.trackedItems.update(item.id!, {
                status: 'reverted',
                currentPrice,
                revertedAt: hostChange.date,
              })
              onUpdate()
            } else {
              await db.trackedItems.update(item.id!, { currentPrice })
            }
          } else {
            await db.trackedItems.update(item.id!, { currentPrice })
          }
        }
      } catch { /* API error — show what we have */ }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [item.itemCode, item.id])

  // Compute before/after sales split
  const { beforeSales, afterSales, chartData } = computeSalesImpact(salesData?.dailySales ?? [], item.changeDate)

  async function handleComplete() {
    await db.trackedItems.update(item.id!, { status: 'completed' })
    onUpdate()
    onBack()
  }

  async function handleDelete() {
    await db.trackedItems.delete(item.id!)
    onUpdate()
    onBack()
  }

  return (
    <div className="p-4 space-y-4">
      <button onClick={onBack} className="text-sm text-violet-600 flex items-center gap-1">
        <ArrowLeft size={14} /> Back to list
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={48} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.description}</p>
          <p className="text-xs text-gray-400">{item.department} &middot; {item.itemCode}</p>
        </div>
        <StatusBadge status={item.status} revertedAt={item.revertedAt} />
      </div>

      {/* Price Status */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Price Status</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-[10px] text-gray-400">Original</p>
            <p className="text-sm font-semibold text-gray-500 line-through">{fmtPrice(item.originalPrice)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Changed to</p>
            <p className="text-sm font-semibold text-violet-600">{fmtPrice(item.newPrice)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Current</p>
            {loading ? (
              <p className="text-sm text-gray-400">...</p>
            ) : (
              <p className={`text-sm font-semibold ${
                priceCheck && Math.abs(priceCheck.RegSellPrice - item.newPrice) < 0.01
                  ? 'text-green-600' : 'text-red-600'
              }`}>
                {priceCheck ? fmtPrice(priceCheck.RegSellPrice) : '—'}
              </p>
            )}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 text-center">
          Changed on {fmtDate(item.changeDate)}
          {item.notes ? ` — ${item.notes}` : ''}
        </p>
      </div>

      {/* Price History */}
      {priceHistory.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">Price History</h3>
          <div className="space-y-1">
            {priceHistory.slice(0, 10).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50">
                <span className="text-gray-500">{fmtDate(h.date)}</span>
                <span className="text-gray-400">{fmtPrice(h.oldPrice)} → {fmtPrice(h.newPrice)}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                  h.changedBy === 'host' ? 'bg-amber-100 text-amber-700'
                    : h.changedBy === 'manual' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {h.changedBy}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales Impact Chart */}
      {salesData && chartData.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">Daily Sales</h3>
          <div className="h-48 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  interval="preserveStartEnd"
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(v: number) => [v.toFixed(1), 'Qty']}
                  labelFormatter={(l: string) => l}
                />
                <ReferenceLine x={fmtDate(item.changeDate)} stroke="#7c3aed" strokeDasharray="4 4" label={{ value: 'Change', fontSize: 9, fill: '#7c3aed' }} />
                <Bar dataKey="qty" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Before vs After comparison */}
      {salesData && (beforeSales.length > 0 || afterSales.length > 0) && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">Sales Impact</h3>
          <ComparisonRow
            label="Avg Daily Qty"
            before={avg(beforeSales.map(s => s.qty))}
            after={avg(afterSales.map(s => s.qty))}
            format={(n) => n.toFixed(1)}
          />
          <ComparisonRow
            label="Avg Daily Revenue"
            before={avg(beforeSales.map(s => s.revenue))}
            after={avg(afterSales.map(s => s.revenue))}
            format={fmtPrice}
          />
          <ComparisonRow
            label="Avg Daily GP"
            before={avg(beforeSales.map(s => s.gp))}
            after={avg(afterSales.map(s => s.gp))}
            format={fmtPrice}
          />
          {salesData.avgCost > 0 && (
            <ComparisonRow
              label="GP Margin"
              before={beforeSales.length > 0 ? ((avg(beforeSales.map(s => s.gp)) / avg(beforeSales.map(s => s.revenue))) * 100) : 0}
              after={afterSales.length > 0 ? ((avg(afterSales.map(s => s.gp)) / avg(afterSales.map(s => s.revenue))) * 100) : 0}
              format={(n) => n.toFixed(1) + '%'}
              invertColor
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {item.status === 'active' && (
          <button onClick={handleComplete} className="flex-1 py-2 bg-green-50 text-green-600 text-sm font-medium rounded-lg">
            Mark Complete
          </button>
        )}
        <button onClick={handleDelete} className="flex-1 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg">
          Remove
        </button>
      </div>
    </div>
  )
}

function ComparisonRow({ label, before, after, format, invertColor }: {
  label: string; before: number; after: number; format: (n: number) => string; invertColor?: boolean
}) {
  const pctChange = before > 0 ? ((after - before) / before) * 100 : 0
  const isPositive = invertColor ? pctChange < 0 : pctChange > 0
  const isNegative = invertColor ? pctChange > 0 : pctChange < 0

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-400">{format(before)}</span>
        <span className="text-gray-300">→</span>
        <span className="font-medium text-gray-700">{format(after)}</span>
        {before > 0 && (
          <span className={`flex items-center gap-0.5 text-[10px] font-medium ${
            isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-400'
          }`}>
            {pctChange > 0 ? <TrendingUp size={10} /> : pctChange < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
            {Math.abs(pctChange).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  )
}

function computeSalesImpact(dailySales: DailySale[], changeDate: string) {
  const beforeSales = dailySales.filter(s => s.date < changeDate)
  const afterSales = dailySales.filter(s => s.date >= changeDate)
  const chartData = dailySales.map(s => ({
    label: fmtDate(s.date),
    date: s.date,
    qty: s.qty,
    revenue: s.revenue,
    gp: s.gp,
  }))
  return { beforeSales, afterSales, chartData }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// ── Main Tracking View ──────────────────────────────────────────────────────

type Filter = 'all' | 'active' | 'reverted' | 'completed'

export default function TrackingView() {
  const trackedItems = useLiveQuery(() => db.trackedItems.toArray(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedItem, setSelectedItem] = useState<TrackedItem | null>(null)
  const [, forceUpdate] = useState(0)

  const refresh = useCallback(() => forceUpdate(n => n + 1), [])

  if (!trackedItems) return <div className="p-4 text-sm text-gray-400">Loading...</div>

  if (selectedItem) {
    // Re-fetch from DB to get latest status
    const current = trackedItems.find(t => t.id === selectedItem.id)
    if (current) {
      return <TrackingDetail item={current} onBack={() => setSelectedItem(null)} onUpdate={refresh} />
    }
    setSelectedItem(null)
  }

  const filtered = trackedItems.filter(t => filter === 'all' || t.status === filter)
  const counts = {
    all: trackedItems.length,
    active: trackedItems.filter(t => t.status === 'active').length,
    reverted: trackedItems.filter(t => t.status === 'reverted').length,
    completed: trackedItems.filter(t => t.status === 'completed').length,
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-100 bg-white shrink-0">
        {(['all', 'active', 'reverted', 'completed'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
              filter === f ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
            {trackedItems.length === 0 ? (
              <>
                <AlertTriangle size={32} className="text-gray-300" />
                <p className="text-sm text-gray-500">No items being tracked</p>
                <p className="text-xs text-gray-400">Tap + to track a price change on a product</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">No {filter} items</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.sort((a, b) => new Date(b.changeDate).getTime() - new Date(a.changeDate).getTime()).map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 text-left"
              >
                <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">
                      {fmtPrice(item.originalPrice)} → <span className="text-violet-600 font-medium">{fmtPrice(item.newPrice)}</span>
                    </span>
                    <span className="text-[10px] text-gray-300">{fmtDate(item.changeDate)}</span>
                  </div>
                </div>
                <StatusBadge status={item.status} revertedAt={item.revertedAt} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="absolute bottom-20 right-4 w-12 h-12 bg-violet-600 text-white rounded-full shadow-lg flex items-center justify-center"
      >
        <Plus size={22} />
      </button>

      {showAdd && <AddItemSheet onClose={() => setShowAdd(false)} />}
    </div>
  )
}
