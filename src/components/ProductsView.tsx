import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { RefreshCw, WifiOff, Search, ScanBarcode, X, Plus, Package, ListPlus, Printer, Tag, MapPin, ClipboardList } from 'lucide-react'
import {
  checkConnection, getStockLevels, getPromotions, searchItems,
  LIQUOR_DEPT_NAMES,
  type StockItem, type LivePromotion,
} from '../lib/jarvis'
import { useTrackedItemCodes } from '../lib/useTrackedItems'
import { useProductCodeLookup } from '../lib/useProductCodes'
import BarcodeScanner from './BarcodeScanner'
import ProductCard from './products/ProductCard'
import CloudStatusBadge from './products/CloudStatusBadge'
import SetTokenSheet from './products/SetTokenSheet'
import PriceChangeSheet from './products/PriceChangeSheet'
import CreateItemSheet from './products/CreateItemSheet'
import CreatePromoSheet from './products/CreatePromoSheet'
import BulkPriceChangeSheet from './products/BulkPriceChangeSheet'
import PrintLabelSheet from './products/PrintLabelSheet'
import BulkPrintSheet from './products/BulkPrintSheet'
import BulkPromoSheet from './products/BulkPromoSheet'
import BulkLocationSheet from './products/BulkLocationSheet'
import BulkAdjustSheet from './products/BulkAdjustSheet'

type Segment = 'all' | 'promo' | 'low'
type DeptFilter = 'all' | 'WINE' | 'BEER' | 'SPIRITS' | 'LIQUEURS' | 'LIQUOR/MISC'
type SortKey = 'revenue' | 'price' | 'qoh'
type SheetType = 'price' | 'promo' | 'createItem' | 'bulkPrice' | 'bulkPromo' | 'printLabel' | 'bulkPrint' | 'bulkLocation' | 'bulkAdjust' | 'token' | null

const DEPT_FILTERS: { key: DeptFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'WINE', label: 'Wine' },
  { key: 'BEER', label: 'Beer' },
  { key: 'SPIRITS', label: 'Spirits' },
  { key: 'LIQUEURS', label: 'Liqueurs' },
  { key: 'LIQUOR/MISC', label: 'Misc' },
]

export default function ProductsView() {
  // Data state
  const [items, setItems] = useState<StockItem[]>([])
  const [promos, setPromos] = useState<LivePromotion[]>([])
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  // Filters
  const [segment, setSegment] = useState<Segment>('all')
  const [deptFilter, setDeptFilter] = useState<DeptFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)

  // Sheets
  const [activeSheet, setActiveSheet] = useState<SheetType>(null)
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null)
  const [cloudRefreshTrigger, setCloudRefreshTrigger] = useState(0)

  const [fabOpen, setFabOpen] = useState(false)
  const [displayLimit, setDisplayLimit] = useState(50)

  const trackedItemCodes = useTrackedItemCodes()
  const { resolveCode } = useProductCodeLookup()
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const searchedItems = useRef<Map<string, StockItem>>(new Map()) // persists scanned/searched items across refreshes

  // Build promo lookup: itemCode → LivePromotion
  const promoMap = useMemo(() => {
    const map = new Map<string, LivePromotion>()
    for (const p of promos) map.set(p.itemCode, p)
    return map
  }, [promos])

  // Fetch all data
  const fetchData = useCallback(async () => {
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
      const [stock, promoData] = await Promise.all([
        getStockLevels({ limit: 5000 }),
        getPromotions(),
      ])
      // Filter to liquor departments, then merge in any search-added items
      const liquorItems = stock.filter(s => LIQUOR_DEPT_NAMES.has(s.department))
      const merged = new Map(liquorItems.map(i => [i.itemCode, i]))
      for (const [code, item] of searchedItems.current) {
        if (!merged.has(code)) merged.set(code, item)
      }
      setItems(Array.from(merged.values()))
      setPromos(promoData.items)
      setLastFetch(new Date())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [fetchData])

  // Debounced server search — returns ALL departments so scanned items always persist
  const handleSearch = useCallback((query: string) => {
    setSearch(query)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!query.trim()) return // client-side filter handles empty
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchItems(query, 100)
        if (res.items.length > 0) {
          // Track non-liquor items so they survive fetchData refreshes
          for (const item of res.items) {
            if (!LIQUOR_DEPT_NAMES.has(item.department)) {
              searchedItems.current.set(item.itemCode, item)
            }
          }
          setItems(prev => {
            const existing = new Map(prev.map(i => [i.itemCode, i]))
            for (const item of res.items) existing.set(item.itemCode, item)
            return Array.from(existing.values())
          })
        }
      } catch { /* keep existing data on search failure */ }
    }, 300)
  }, [])

  // Handle barcode scan
  const handleScan = useCallback((code: string) => {
    setScannerOpen(false)
    const resolved = resolveCode(code)
    handleSearch(resolved)
  }, [resolveCode, handleSearch])

  // Handle action from ProductCard
  function handleCardAction(item: StockItem, action: 'price' | 'promo' | 'createItem' | 'printLabel') {
    setSelectedItem(item)
    setActiveSheet(action)
  }

  // Refresh a single item from the server
  const refreshItem = useCallback(async (itemCode: string) => {
    try {
      const res = await searchItems(itemCode, 5)
      const match = res.items.find(i => i.itemCode === itemCode)
      if (match) {
        setItems(prev => prev.map(i => i.itemCode === itemCode ? match : i))
        // Also update selectedItem if it's the same
        setSelectedItem(prev => prev?.itemCode === itemCode ? match : prev)
      }
    } catch { /* keep existing data */ }
  }, [])

  // Optimistic price update — called by PriceChangeSheet on success
  const updateItemPrice = useCallback((itemCode: string, newPrice: number) => {
    setItems(prev => prev.map(i =>
      i.itemCode === itemCode ? { ...i, sellPrice: newPrice } : i
    ))
    setSelectedItem(prev =>
      prev?.itemCode === itemCode ? { ...prev, sellPrice: newPrice } : prev
    )
  }, [])

  // Toggle price lock on a product
  const toggleItemLock = useCallback((itemCode: string, locked: boolean) => {
    setItems(prev => prev.map(i =>
      i.itemCode === itemCode ? { ...i, priceLocked: locked } : i
    ))
  }, [])

  // Apply filters + sort
  const displayed = useMemo(() => {
    let list = items

    // Search filter (client-side for instant feedback)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
    }

    // Segment filter
    if (segment === 'promo') {
      list = list.filter(i => promoMap.has(i.itemCode))
    } else if (segment === 'low') {
      list = list.filter(i => i.onHand < i.reorderLevel)
    }

    // Department filter
    if (deptFilter !== 'all') {
      list = list.filter(i => i.department === deptFilter)
    }

    // Sort
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'revenue': return (b.avgDayQty * b.sellPrice) - (a.avgDayQty * a.sellPrice)
        case 'price': return b.sellPrice - a.sellPrice
        case 'qoh': return a.onHand - b.onHand
        default: return 0
      }
    })

    return list
  }, [items, search, segment, deptFilter, sortKey, promoMap])

  // Department counts for filter badges
  const deptCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    let filtered = items
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q))
      )
    }
    if (segment === 'promo') filtered = filtered.filter(i => promoMap.has(i.itemCode))
    else if (segment === 'low') filtered = filtered.filter(i => i.onHand < i.reorderLevel)
    for (const i of filtered) counts[i.department] = (counts[i.department] ?? 0) + 1
    return counts
  }, [items, search, segment, promoMap])

  const totalFiltered = Object.values(deptCounts).reduce((s, c) => s + c, 0)

  // Reset pagination when filters change
  useEffect(() => { setDisplayLimit(50) }, [search, segment, deptFilter, sortKey])

  // Paginated display
  const paginatedDisplay = useMemo(() => displayed.slice(0, displayLimit), [displayed, displayLimit])

  // Segment counts
  const promoCt = useMemo(() => items.filter(i => promoMap.has(i.itemCode)).length, [items, promoMap])
  const lowCt = useMemo(() => items.filter(i => i.onHand < i.reorderLevel).length, [items])

  // ── Not connected ──
  if (connected === false || (error && items.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <WifiOff size={32} className="text-gray-300" />
        <p className="text-sm font-medium text-gray-500">Cannot reach JARVISmart</p>
        {error && <p className="text-xs text-gray-400">{error}</p>}
        <button onClick={fetchData} className="text-sm text-violet-600 underline">Retry</button>
      </div>
    )
  }

  // ── First load ──
  if (items.length === 0 && loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <RefreshCw size={24} className="text-violet-400 animate-spin" />
        <p className="text-sm text-gray-400">Loading products...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Package size={14} className="text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">{items.length}</span>
            <span className="text-xs text-gray-400">products</span>
          </div>
          <CloudStatusBadge
            onTap={() => setActiveSheet('token')}
            refreshTrigger={cloudRefreshTrigger}
          />
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-violet-600 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {lastFetch && <span>{lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        </button>
      </div>

      {/* Segment tabs */}
      <div className="flex border-b border-gray-100">
        {([
          { key: 'all' as Segment, label: 'All', count: items.length },
          { key: 'promo' as Segment, label: 'On Promo', count: promoCt },
          { key: 'low' as Segment, label: 'Low Stock', count: lowCt },
        ]).map(s => (
          <button
            key={s.key}
            onClick={() => setSegment(s.key)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              segment === s.key ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'
            }`}
          >
            {s.label} ({s.count})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2 px-4 py-2 border-b border-gray-100">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search product, barcode, item code..."
            className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); searchedItems.current.clear(); fetchData() }}
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
          return (
            <button
              key={f.key}
              onClick={() => setDeptFilter(f.key)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                deptFilter === f.key ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
          { key: 'revenue' as SortKey, label: 'Revenue' },
          { key: 'price' as SortKey, label: 'Price' },
          { key: 'qoh' as SortKey, label: 'QOH' },
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

      {/* Product list */}
      <div className="flex-1 overflow-auto p-4 space-y-2 pb-20">
        {displayed.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Package size={32} className="text-gray-200" />
            <p className="text-sm text-gray-400">
              {search ? `No results for "${search}"` : `No products${deptFilter !== 'all' ? ` in ${deptFilter}` : ''}`}
            </p>
          </div>
        )}
        {paginatedDisplay.map(item => (
          <ProductCard
            key={item.itemCode}
            item={item}
            promo={promoMap.get(item.itemCode)}
            isTracked={trackedItemCodes.has(item.itemCode)}
            onAction={(action) => handleCardAction(item, action)}
            onRefresh={() => refreshItem(item.itemCode)}
            onToggleLock={(locked) => toggleItemLock(item.itemCode, locked)}
          />
        ))}
        {displayLimit < displayed.length && (
          <button
            onClick={() => setDisplayLimit(prev => prev + 50)}
            className="w-full py-3 text-sm font-medium text-violet-600 bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors"
          >
            Show more ({displayed.length - displayLimit} remaining)
          </button>
        )}
      </div>

      {/* FAB Menu */}
      <div className="fixed bottom-20 right-4 z-30 flex flex-col items-end gap-2">
        {fabOpen && (
          <>
            <button
              onClick={() => { setFabOpen(false); setActiveSheet('createItem') }}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-full shadow-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <Package size={16} className="text-violet-500" /> New Item
            </button>
            <button
              onClick={() => { setFabOpen(false); setActiveSheet('bulkPrice') }}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-full shadow-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <ListPlus size={16} className="text-violet-500" /> Bulk Price Change
            </button>
            <button
              onClick={() => { setFabOpen(false); setActiveSheet('bulkPromo') }}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-full shadow-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <Tag size={16} className="text-violet-500" /> Bulk Promotions
            </button>
            <button
              onClick={() => { setFabOpen(false); setActiveSheet('bulkPrint') }}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-full shadow-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <Printer size={16} className="text-violet-500" /> Bulk Print Labels
            </button>
            <button
              onClick={() => { setFabOpen(false); setActiveSheet('bulkLocation') }}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-full shadow-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <MapPin size={16} className="text-blue-500" /> Bulk Location
            </button>
            <button
              onClick={() => { setFabOpen(false); setActiveSheet('bulkAdjust') }}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-full shadow-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <ClipboardList size={16} className="text-emerald-500" /> Bulk QOH Adjust
            </button>
          </>
        )}
        <button
          onClick={() => setFabOpen(o => !o)}
          className={`w-12 h-12 bg-violet-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-violet-700 active:scale-95 transition-all ${fabOpen ? 'rotate-45' : ''}`}
          title="Actions"
        >
          <Plus size={20} />
        </button>
      </div>
      {fabOpen && <div className="fixed inset-0 z-20" onClick={() => setFabOpen(false)} />}

      {/* Barcode Scanner */}
      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />

      {/* Bottom Sheets */}
      {activeSheet === 'token' && (
        <SetTokenSheet
          onClose={() => setActiveSheet(null)}
          onSuccess={() => setCloudRefreshTrigger(n => n + 1)}
        />
      )}
      {activeSheet === 'price' && selectedItem && (
        <PriceChangeSheet
          item={selectedItem}
          onClose={() => setActiveSheet(null)}
          onSuccess={(newPrice) => {
            updateItemPrice(selectedItem.itemCode, newPrice)
            // Also do a background full refresh for eventual consistency
            fetchData()
          }}
        />
      )}
      {activeSheet === 'createItem' && (
        <CreateItemSheet
          onClose={() => setActiveSheet(null)}
          onSuccess={fetchData}
        />
      )}
      {activeSheet === 'promo' && selectedItem && (
        <CreatePromoSheet
          item={selectedItem}
          onClose={() => setActiveSheet(null)}
          onSuccess={fetchData}
        />
      )}
      {activeSheet === 'bulkPrice' && (
        <BulkPriceChangeSheet
          items={items}
          onClose={() => setActiveSheet(null)}
          onSuccess={fetchData}
        />
      )}
      {activeSheet === 'printLabel' && selectedItem && (
        <PrintLabelSheet
          item={selectedItem}
          onClose={() => setActiveSheet(null)}
        />
      )}
      {activeSheet === 'bulkPromo' && (
        <BulkPromoSheet
          items={items}
          onClose={() => setActiveSheet(null)}
          onSuccess={fetchData}
        />
      )}
      {activeSheet === 'bulkPrint' && (
        <BulkPrintSheet
          items={items}
          onClose={() => setActiveSheet(null)}
        />
      )}
      {activeSheet === 'bulkLocation' && (
        <BulkLocationSheet
          items={items}
          onClose={() => setActiveSheet(null)}
        />
      )}
      {activeSheet === 'bulkAdjust' && (
        <BulkAdjustSheet
          items={items}
          onClose={() => setActiveSheet(null)}
          onSuccess={fetchData}
        />
      )}
    </div>
  )
}
