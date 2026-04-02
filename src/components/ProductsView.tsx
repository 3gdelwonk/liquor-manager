import { useState, useMemo, useCallback } from 'react'
import { Search, ChevronDown, ChevronUp, ScanBarcode } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import BarcodeScanner from './BarcodeScanner'
import BarcodeStripe from './BarcodeStripe'
import { useProductCodeLookup } from '../lib/useProductCodes'
import { db } from '../lib/db'
import { getLatestQoh } from '../lib/analytics'
import { useTrackedItemCodes } from '../lib/useTrackedItems'
import { CATEGORY_LABELS, CATEGORY_COLORS, CATEGORY_ORDER } from '../lib/constants'
import type { Product, LiquorCategory } from '../lib/types'

type SortKey = 'name' | 'qoh' | 'status' | 'days'

function QohGauge({ qoh, min, max }: { qoh: number; min: number; max: number | undefined }) {
  const effectiveMax = (max ?? (min * 3)) || 10
  const pct = Math.min(100, Math.max(0, (qoh / effectiveMax) * 100))
  const minPct = Math.min(100, (min / effectiveMax) * 100)
  const color = qoh < min ? '#ef4444' : max && qoh > max ? '#f59e0b' : '#10b981'
  return (
    <div className="relative h-2 bg-gray-100 rounded-full mt-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      {min > 0 && <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 rounded" style={{ left: `${minPct}%` }} />}
    </div>
  )
}

function statusLabel(qoh: number | undefined, min: number, max: number | undefined): string {
  if (qoh === undefined) return 'Unknown'
  if (qoh < min) return 'Low'
  if (max && qoh > max) return 'Over'
  return 'Good'
}

function statusColor(status: string): string {
  return status === 'Low' ? 'text-red-600 bg-red-50' : status === 'Over' ? 'text-amber-600 bg-amber-50' : status === 'Good' ? 'text-green-600 bg-green-50' : 'text-gray-500 bg-gray-50'
}

function ProductRow({ product, qoh, activePromo, isTracked }: { product: Product; qoh: number | undefined; activePromo: boolean; isTracked: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [edit, setEdit] = useState({ ...product })
  const [saving, setSaving] = useState(false)

  const status = statusLabel(qoh, product.minStockLevel, product.maxStockLevel)

  async function save() {
    setSaving(true)
    try {
      await db.products.update(product.id!, {
        minStockLevel: Number(edit.minStockLevel),
        maxStockLevel: edit.maxStockLevel ? Number(edit.maxStockLevel) : undefined,
        sellPrice: Number(edit.sellPrice),
        costPrice: Number(edit.costPrice),
        abv: edit.abv ? Number(edit.abv) : undefined,
        bottleSize: edit.bottleSize ? Number(edit.bottleSize) : undefined,
        notes: edit.notes || undefined,
        updatedAt: new Date(),
      })
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button className="w-full text-left py-3 px-0" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-start gap-2 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-gray-900 truncate">{product.name}</span>
              {activePromo && <span className="text-xs font-medium px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full shrink-0">PROMO</span>}
              {isTracked && <span className="text-xs font-medium px-1.5 py-0.5 bg-cyan-100 text-cyan-700 rounded-full shrink-0">TRACKING</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: CATEGORY_COLORS[product.category] + '22', color: CATEGORY_COLORS[product.category] }}>
                {CATEGORY_LABELS[product.category]}
              </span>
              {product.itemNumber && <span className="text-[10px] text-gray-400 font-mono">#{product.itemNumber}</span>}
              <span className="text-[10px] text-gray-300 font-mono">{product.barcode}</span>
              {product.abv && <span className="text-xs text-gray-400">{product.abv}%</span>}
              {product.bottleSize && <span className="text-xs text-gray-400">{product.bottleSize}ml</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${statusColor(status)}`}>{status}</span>
            <p className="text-xs text-gray-500 mt-0.5">QOH {qoh ?? '?'}</p>
          </div>
          <div className="text-gray-400 shrink-0 mt-1">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
        </div>
        {qoh !== undefined && (
          <QohGauge qoh={qoh} min={product.minStockLevel} max={product.maxStockLevel} />
        )}
      </button>

      {expanded && (
        <div className="pb-3 space-y-3">
          <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {product.itemNumber && <div><span className="text-gray-400">Order Code:</span> <span className="font-mono font-medium">{product.itemNumber}</span></div>}
              <div><span className="text-gray-400">POS:</span> <span className="font-mono">{product.invoiceCode}</span></div>
            </div>
            <div className="flex justify-center">
              <BarcodeStripe value={product.barcode} height={44} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Min Stock', key: 'minStockLevel', type: 'number' },
              { label: 'Max Stock', key: 'maxStockLevel', type: 'number' },
              { label: 'Sell Price', key: 'sellPrice', type: 'number' },
              { label: 'Cost Price', key: 'costPrice', type: 'number' },
              { label: 'ABV %', key: 'abv', type: 'number' },
              { label: 'Bottle Size (ml)', key: 'bottleSize', type: 'number' },
            ].map(({ label, key, type }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">{label}</span>
                <input
                  type={type}
                  value={(edit as unknown as Record<string, unknown>)[key] as string ?? ''}
                  onChange={(e) => setEdit(prev => ({ ...prev, [key]: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Notes</span>
            <textarea
              value={edit.notes ?? ''}
              onChange={(e) => setEdit(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
            />
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex-1 bg-violet-600 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEdit({ ...product }); setExpanded(false) }} className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-2 rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProductsView() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const snapshots = useLiveQuery(() => db.stockSnapshots.toArray(), [])
  const promotions = useLiveQuery(() => db.promotions.toArray(), [])

  const trackedItemCodes = useTrackedItemCodes()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<LiquorCategory | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [scannerOpen, setScannerOpen] = useState(false)
  const { resolveCode } = useProductCodeLookup()

  const handleScan = useCallback((code: string) => {
    setScannerOpen(false)
    setSearch(resolveCode(code))
  }, [resolveCode])

  const { latestQoh, activePromoIds } = useMemo(() => {
    const lq = snapshots ? getLatestQoh(snapshots) : new Map<number, number>()
    const today = new Date().toISOString().slice(0, 10)
    const promoIds = new Set<number>()
    if (promotions) {
      for (const p of promotions) {
        if (p.startDate <= today && p.endDate >= today) promoIds.add(p.productId)
      }
    }
    return { latestQoh: lq, activePromoIds: promoIds }
  }, [snapshots, promotions])

  const filtered = useMemo(() => {
    if (!products) return []
    let list = products
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(search) || p.invoiceCode.toLowerCase().includes(q) || (p.itemNumber && p.itemNumber.toLowerCase().includes(q)))
    }
    if (catFilter !== 'all') list = list.filter(p => p.category === catFilter)

    return list.sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name)
        case 'qoh': return (latestQoh.get(b.id!) ?? -1) - (latestQoh.get(a.id!) ?? -1)
        case 'status': return statusLabel(latestQoh.get(a.id!), a.minStockLevel, a.maxStockLevel).localeCompare(statusLabel(latestQoh.get(b.id!), b.minStockLevel, b.maxStockLevel))
        default: return 0
      }
    })
  }, [products, search, catFilter, sort, latestQoh])

  if (!products) return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>

  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <p className="text-sm text-gray-500">No products. Import Item Maintenance to populate.</p>
      </div>
    )
  }

  // Group by category
  const byCategory = new Map<LiquorCategory, Product[]>()
  for (const p of filtered) {
    const arr = byCategory.get(p.category) ?? []
    arr.push(p)
    byCategory.set(p.category, arr)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 bg-white z-10 border-b border-gray-100 px-4 pt-3 pb-2 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, barcode, order code…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <button
            onClick={() => setScannerOpen(true)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
            title="Scan barcode"
          >
            <ScanBarcode size={18} />
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setCatFilter('all')}
            className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${catFilter === 'all' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >All</button>
          {CATEGORY_ORDER.map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${catFilter === cat ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >{CATEGORY_LABELS[cat]}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['name', 'qoh', 'status'] as SortKey[]).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${sort === s ? 'bg-violet-100 text-violet-700' : 'bg-gray-50 text-gray-500'}`}
            >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4">
        {CATEGORY_ORDER.filter(cat => byCategory.has(cat)).map(cat => (
          <div key={cat}>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-4 pb-1">{CATEGORY_LABELS[cat]}</h3>
            {(byCategory.get(cat) ?? []).map(p => (
              <ProductRow
                key={p.id}
                product={p}
                qoh={p.id ? latestQoh.get(p.id) : undefined}
                activePromo={!!p.id && activePromoIds.has(p.id)}
                isTracked={trackedItemCodes.has(p.barcode)}
              />
            ))}
          </div>
        ))}
        {/* Any category not in CATEGORY_ORDER */}
        {filtered.filter(p => !CATEGORY_ORDER.includes(p.category)).map(p => (
          <ProductRow key={p.id} product={p} qoh={p.id ? latestQoh.get(p.id) : undefined} activePromo={!!p.id && activePromoIds.has(p.id)} isTracked={trackedItemCodes.has(p.barcode)} />
        ))}
        {filtered.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No products match filters</p>}
        <div className="h-8" />
      </div>
      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
