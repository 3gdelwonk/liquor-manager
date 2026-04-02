import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Plus, Search, ArrowLeft, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle, XCircle, ScanBarcode, Bell, X, RefreshCw, Tag, DollarSign, Calendar,
  ChevronUp, ChevronDown, ArrowUpDown, Edit3, MessageSquare
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'
import { db, type TrackedItem, type TrackedPromo } from '../lib/db'
import {
  searchItems, getItemPrice, getPriceHistory, getItemSales,
  getPromotions
} from '../lib/jarvis'
import type { PriceCheck, PriceHistoryEntry, ItemSalesData, DailySale, LivePromotion } from '../lib/jarvis'
import ProductImage from './ProductImage'
import BarcodeScanner from './BarcodeScanner'

type TrackMode = 'host' | 'user'

// ════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════════════════════════════

function parseDate(iso: string | null | undefined): Date {
  if (!iso) return new Date(NaN)
  // Handle both "2026-04-01" and "2026-04-01T00:00:00Z" formats
  const dateOnly = iso.slice(0, 10)
  return new Date(dateOnly + 'T00:00:00')
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseDate(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10) || '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function fmtDateFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseDate(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10) || '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtPrice(n: number): string {
  return '$' + n.toFixed(2)
}

// Strip pack-size suffixes to group singles/4pk/carton together
const PACK_PATTERNS = /\b(singles?|stubbies|stbs?|cans?|bottles?|btls?|longnecks?|lnk|4\s*p(?:ac)?k|6\s*p(?:ac)?k|10\s*p(?:ac)?k|24\s*p(?:ac)?k|30\s*p(?:ac)?k|ctn|carton|slab|case|\d+\s*x\s*\d+ml|\d+ml|\d+\s*lt?r?)\b/gi

function extractBaseName(description: string): string {
  return description
    .replace(PACK_PATTERNS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

type ChartMode = 'daily' | 'weekly'

interface ChartPoint {
  label: string
  date: string
  qty: number
  revenue: number
  gp: number
}

function getWeekStart(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = parseDate(dateStr)
  if (isNaN(d.getTime())) return dateStr.slice(0, 10)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

function aggregateWeekly(dailySales: DailySale[]): ChartPoint[] {
  const weeks = new Map<string, { qty: number; revenue: number; gp: number; count: number }>()
  for (const s of dailySales) {
    const weekKey = getWeekStart(s.date)
    const w = weeks.get(weekKey) ?? { qty: 0, revenue: 0, gp: 0, count: 0 }
    w.qty += s.qty
    w.revenue += s.revenue
    w.gp += s.gp
    w.count++
    weeks.set(weekKey, w)
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, w]) => ({
      label: fmtDate(weekKey),
      date: weekKey,
      qty: w.qty,
      revenue: w.revenue,
      gp: w.gp,
    }))
}

function computeSalesImpact(dailySales: DailySale[], changeDate: string, chartMode: ChartMode) {
  const beforeSales = dailySales.filter(s => s.date < changeDate)
  const afterSales = dailySales.filter(s => s.date >= changeDate)

  const dailyChartData: ChartPoint[] = dailySales.map(s => ({
    label: fmtDate(s.date),
    date: s.date,
    qty: s.qty,
    revenue: s.revenue,
    gp: s.gp,
  }))

  const chartData = chartMode === 'weekly' ? aggregateWeekly(dailySales) : dailyChartData
  // For weekly mode, find which week label the change date falls into
  const changeDateLabel = chartMode === 'weekly' ? fmtDate(getWeekStart(changeDate)) : fmtDate(changeDate)

  return { beforeSales, afterSales, chartData, changeDateLabel }
}

function ChartModeToggle({ mode, onChange }: { mode: ChartMode; onChange: (m: ChartMode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 shrink-0">
      <button
        onClick={() => onChange('daily')}
        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
          mode === 'daily' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500'
        }`}
      >Daily</button>
      <button
        onClick={() => onChange('weekly')}
        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
          mode === 'weekly' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500'
        }`}
      >Weekly</button>
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

// ── Reorder helpers ─────────────────────────────────────────────────────────

function sortByOrder<T extends { sortOrder?: number; createdAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const oa = a.sortOrder ?? Infinity
    const ob = b.sortOrder ?? Infinity
    if (oa !== ob) return oa - ob
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

async function swapOrder(
  table: 'trackedPromos' | 'trackedItems',
  items: { id?: number; sortOrder?: number }[],
  fromIndex: number,
  toIndex: number
) {
  if (toIndex < 0 || toIndex >= items.length) return
  const a = items[fromIndex]
  const b = items[toIndex]
  if (!a.id || !b.id) return
  const orderA = a.sortOrder ?? fromIndex
  const orderB = b.sortOrder ?? toIndex
  const dbTable = table === 'trackedPromos' ? db.trackedPromos : db.trackedItems
  await dbTable.update(a.id, { sortOrder: orderB })
  await dbTable.update(b.id, { sortOrder: orderA })
}

async function assignOrderIfNeeded(
  table: 'trackedPromos' | 'trackedItems',
  items: { id?: number; sortOrder?: number }[]
) {
  const dbTable = table === 'trackedPromos' ? db.trackedPromos : db.trackedItems
  let needsAssign = false
  for (const item of items) {
    if (item.sortOrder === undefined) { needsAssign = true; break }
  }
  if (needsAssign) {
    await db.transaction('rw', dbTable, async () => {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id && items[i].sortOrder === undefined) {
          await dbTable.update(items[i].id!, { sortOrder: i })
        }
      }
    })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Notes & Tags — shared between promo and price detail views
// ════════════════════════════════════════════════════════════════════════════

const PRESET_TAGS = [
  { label: 'Best Seller', color: 'bg-green-100 text-green-700' },
  { label: 'Slow Mover', color: 'bg-red-100 text-red-700' },
  { label: 'Seasonal', color: 'bg-amber-100 text-amber-700' },
  { label: 'New Line', color: 'bg-blue-100 text-blue-700' },
  { label: 'Clearance', color: 'bg-pink-100 text-pink-700' },
  { label: 'High Margin', color: 'bg-emerald-100 text-emerald-700' },
  { label: 'Low Margin', color: 'bg-orange-100 text-orange-700' },
  { label: 'Watch', color: 'bg-violet-100 text-violet-700' },
]

function getTagColor(tag: string): string {
  const preset = PRESET_TAGS.find(t => t.label === tag)
  return preset?.color ?? 'bg-gray-100 text-gray-600'
}

function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${getTagColor(tag)}`}>
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 hover:opacity-70"><X size={10} /></button>
      )}
    </span>
  )
}

function NotesAndTags({ notes, tags, onSaveNotes, onSaveTags }: {
  notes: string
  tags: string[]
  onSaveNotes: (notes: string) => void
  onSaveTags: (tags: string[]) => void
}) {
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(notes)
  const [customTag, setCustomTag] = useState('')

  function handleSaveNotes() {
    onSaveNotes(notesDraft)
    setEditingNotes(false)
  }

  function toggleTag(label: string) {
    if (tags.includes(label)) {
      onSaveTags(tags.filter(t => t !== label))
    } else {
      onSaveTags([...tags, label])
    }
  }

  function addCustomTag() {
    const trimmed = customTag.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onSaveTags([...tags, trimmed])
    }
    setCustomTag('')
  }

  return (
    <div className="space-y-3">
      {/* Notes */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MessageSquare size={12} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase">Notes</span>
          </div>
          {!editingNotes && (
            <button onClick={() => { setNotesDraft(notes); setEditingNotes(true) }} className="text-[10px] text-violet-600 font-medium">
              {notes ? 'Edit' : 'Add Note'}
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-1.5">
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="Add notes about this product..."
              rows={3}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
            <div className="flex gap-1.5 justify-end">
              <button onClick={() => setEditingNotes(false)} className="px-2.5 py-1 text-[10px] text-gray-500 font-medium">Cancel</button>
              <button onClick={handleSaveNotes} className="px-2.5 py-1 bg-violet-600 text-white text-[10px] font-medium rounded-lg">Save</button>
            </div>
          </div>
        ) : notes ? (
          <p className="text-xs text-gray-600 whitespace-pre-wrap">{notes}</p>
        ) : (
          <p className="text-[10px] text-gray-300 italic">No notes yet</p>
        )}
      </div>

      {/* Tags */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Tag size={12} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase">Tags</span>
        </div>

        {/* Current tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <TagBadge key={tag} tag={tag} onRemove={() => toggleTag(tag)} />
            ))}
          </div>
        )}

        {/* Preset tag chips */}
        <div className="flex flex-wrap gap-1">
          {PRESET_TAGS.filter(t => !tags.includes(t.label)).map(t => (
            <button
              key={t.label}
              onClick={() => toggleTag(t.label)}
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-violet-400 hover:text-violet-600 transition-colors`}
            >
              + {t.label}
            </button>
          ))}
        </div>

        {/* Custom tag input */}
        <div className="flex gap-1">
          <input
            value={customTag}
            onChange={e => setCustomTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomTag()}
            placeholder="Custom tag..."
            className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            onClick={addCustomTag}
            disabled={!customTag.trim()}
            className="px-2 py-1 bg-violet-600 text-white text-[10px] font-medium rounded-lg disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PROMO TRACKING MODE
// ════════════════════════════════════════════════════════════════════════════

const MAX_PROMO_RESULTS = 30

function promoTimingBadge(startDate: string | null | undefined, endDate: string | null | undefined): { label: string; className: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (!isNaN(start.getTime()) && start > today) {
    return { label: 'Upcoming', className: 'bg-amber-100 text-amber-700' }
  }
  if (!isNaN(end.getTime()) && end < today) {
    return { label: 'Ended', className: 'bg-gray-100 text-gray-500' }
  }
  return { label: 'Active', className: 'bg-green-100 text-green-700' }
}

type PromoSheetView = 'list' | 'manual'

function AddPromoSheet({ onClose }: { onClose: () => void }) {
  const [livePromos, setLivePromos] = useState<LivePromotion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [view, setView] = useState<PromoSheetView>('list')

  // Manual entry state
  const [manualSearch, setManualSearch] = useState('')
  const [manualDebouncedSearch, setManualDebouncedSearch] = useState('')
  const [manualResults, setManualResults] = useState<{ itemCode: string; description: string; department: string; barcode: string | null; sellPrice: number }[]>([])
  const [manualLoading, setManualLoading] = useState(false)
  const [manualSelected, setManualSelected] = useState<{ itemCode: string; description: string; department: string; barcode: string | null; sellPrice: number } | null>(null)
  const [manualNormalPrice, setManualNormalPrice] = useState('')
  const [manualPromoPrice, setManualPromoPrice] = useState('')
  const [manualStartDate, setManualStartDate] = useState('')
  const [manualEndDate, setManualEndDate] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  const existingPromos = useLiveQuery(() => db.trackedPromos.toArray(), [])
  const existingCodes = useMemo(() => new Set((existingPromos ?? []).map(p => p.itemCode)), [existingPromos])

  useEffect(() => {
    getPromotions()
      .then(data => setLivePromos(data.items))
      .catch(() => setLivePromos([]))
      .finally(() => setLoading(false))
  }, [])

  // Debounce search to avoid re-rendering hundreds of ProductImages per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  // Manual entry: debounce + search items
  useEffect(() => {
    const timer = setTimeout(() => setManualDebouncedSearch(manualSearch), 300)
    return () => clearTimeout(timer)
  }, [manualSearch])

  useEffect(() => {
    if (!manualDebouncedSearch.trim()) { setManualResults([]); return }
    let cancelled = false
    setManualLoading(true)
    searchItems(manualDebouncedSearch, 20)
      .then(res => {
        if (!cancelled) {
          setManualResults(res.items.map(i => ({
            itemCode: i.itemCode,
            description: i.description,
            department: i.department,
            barcode: i.barcode ?? null,
            sellPrice: i.sellPrice ?? 0,
          })))
        }
      })
      .catch(() => { if (!cancelled) setManualResults([]) })
      .finally(() => { if (!cancelled) setManualLoading(false) })
    return () => { cancelled = true }
  }, [manualDebouncedSearch])

  async function handleManualSave() {
    if (!manualSelected || !manualStartDate || !manualEndDate) return
    setManualSaving(true)
    const np = parseFloat(manualNormalPrice) || manualSelected.sellPrice
    const pp = parseFloat(manualPromoPrice) || np
    const discount = np > 0 ? ((np - pp) / np) * 100 : 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = parseDate(manualEndDate)
    const daysLeft = !isNaN(end.getTime()) ? Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000)) : 0
    await db.trackedPromos.add({
      itemCode: manualSelected.itemCode,
      barcode: manualSelected.barcode,
      description: manualSelected.description,
      department: manualSelected.department,
      normalPrice: np,
      promoPrice: pp,
      promoUnitCost: null,
      normalUnitCost: 0,
      ctnQty: 1,
      discountPercent: discount,
      marginPercent: 0,
      costSavingPercent: null,
      startDate: manualStartDate,
      endDate: manualEndDate,
      daysLeft,
      notes: '',
      source: 'manual',
      status: 'active',
      createdAt: new Date(),
    })
    setManualSaving(false)
    setManualSelected(null)
    setManualSearch('')
    setManualNormalPrice('')
    setManualPromoPrice('')
    setManualStartDate('')
    setManualEndDate('')
    setView('list')
  }

  const { filtered, totalMatches } = useMemo(() => {
    if (!livePromos) return { filtered: [], totalMatches: 0 }
    let list = livePromos.filter(p => !existingCodes.has(p.itemCode))
    if (debouncedSearch.trim()) {
      const words = debouncedSearch.trim().toLowerCase().split(/\s+/)
      // Score each item: all-words-match first, then partial matches
      const scored = list.map(p => {
        const desc = p.description.toLowerCase()
        const code = p.itemCode.toLowerCase()
        const matchCount = words.filter(w => desc.includes(w) || code.includes(w)).length
        return { promo: p, matchCount, allMatch: matchCount === words.length }
      }).filter(s => s.matchCount > 0)

      // Sort: all keywords matched first, then by match count, then group related items together
      scored.sort((a, b) => {
        if (a.allMatch !== b.allMatch) return a.allMatch ? -1 : 1
        if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount
        const baseA = extractBaseName(a.promo.description)
        const baseB = extractBaseName(b.promo.description)
        if (baseA === baseB) return a.promo.description.localeCompare(b.promo.description)
        return 0
      })
      list = scored.map(s => s.promo)
    } else {
      list.sort((a, b) => b.discountPercent - a.discountPercent)
    }
    const total = list.length
    return { filtered: list.slice(0, MAX_PROMO_RESULTS), totalMatches: total }
  }, [livePromos, debouncedSearch, existingCodes])

  async function handleTrack(promo: LivePromotion) {
    setSaving(promo.itemCode)
    await db.trackedPromos.add({
      itemCode: promo.itemCode,
      barcode: null,
      description: promo.description,
      department: promo.department,
      normalPrice: promo.normalPrice,
      promoPrice: promo.promoPrice,
      promoUnitCost: promo.promoUnitCost,
      normalUnitCost: promo.normalUnitCost,
      ctnQty: promo.ctnQty,
      discountPercent: promo.discountPercent,
      marginPercent: promo.marginPercent,
      costSavingPercent: promo.costSavingPercent,
      startDate: promo.startDate,
      endDate: promo.endDate,
      daysLeft: promo.daysLeft,
      notes: '',
      source: 'system',
      status: 'active',
      createdAt: new Date(),
    })
    setSaving(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-5 space-y-3 pb-safe max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Track a Promotion</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* View toggle: Live promos vs Manual entry */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setView('list')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'list' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500'}`}
          >
            <Tag size={12} />
            Live Promos
          </button>
          <button
            onClick={() => setView('manual')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'manual' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500'}`}
          >
            <Edit3 size={12} />
            Manual Entry
          </button>
        </div>

        {view === 'list' ? (
          <>
            <p className="text-xs text-gray-400">Select from live host/system promotions to track performance</p>

            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search promotions..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-8"><RefreshCw size={20} className="text-violet-400 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                {search ? 'No matching promotions' : 'All live promotions are already being tracked'}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[50vh] overflow-auto">
                {filtered.map(promo => {
                  const badge = promoTimingBadge(promo.startDate, promo.endDate)
                  return (
                    <div key={promo.itemCode} className="flex items-center gap-2.5 p-2.5 border border-gray-100 rounded-lg">
                      <ProductImage itemCode={promo.itemCode} description={promo.description} department={promo.department} size={40} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-gray-900 truncate">{promo.description}</p>
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400">
                            {fmtPrice(promo.normalPrice)} → <span className="text-green-600 font-medium">{fmtPrice(promo.promoPrice)}</span>
                          </span>
                          <span className="text-[10px] text-green-600 font-medium">{promo.discountPercent.toFixed(0)}% off</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400">{fmtDate(promo.startDate)} → {fmtDate(promo.endDate)}</span>
                          {badge.label === 'Upcoming'
                            ? <span className="text-[10px] text-amber-600">Starts in {Math.ceil((parseDate(promo.startDate).getTime() - Date.now()) / 86400000)}d</span>
                            : <span className="text-[10px] text-gray-400">{promo.daysLeft}d left</span>
                          }
                        </div>
                      </div>
                      <button
                        onClick={() => handleTrack(promo)}
                        disabled={saving === promo.itemCode}
                        className="px-3 py-1.5 bg-violet-600 text-white text-[10px] font-medium rounded-lg shrink-0 disabled:opacity-50"
                      >
                        {saving === promo.itemCode ? '...' : 'Track'}
                      </button>
                    </div>
                  )
                })}
                {totalMatches > MAX_PROMO_RESULTS && (
                  <p className="text-[10px] text-gray-400 text-center py-2">
                    Showing {MAX_PROMO_RESULTS} of {totalMatches} — type more to narrow results
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          /* ── Manual promo entry ── */
          <div className="space-y-3">
            <p className="text-xs text-gray-400">Manually add a promotion for items not yet in the system</p>

            {!manualSelected ? (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={manualSearch}
                    onChange={e => setManualSearch(e.target.value)}
                    placeholder="Search product to add..."
                    className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
                {manualLoading && (
                  <div className="flex justify-center py-4"><RefreshCw size={16} className="text-violet-400 animate-spin" /></div>
                )}
                {!manualLoading && manualResults.length > 0 && (
                  <div className="space-y-1 max-h-[40vh] overflow-auto">
                    {manualResults.filter(r => !existingCodes.has(r.itemCode)).map(item => (
                      <button
                        key={item.itemCode}
                        onClick={() => {
                          setManualSelected(item)
                          setManualNormalPrice(item.sellPrice.toFixed(2))
                        }}
                        className="w-full flex items-center gap-2.5 p-2.5 border border-gray-100 rounded-lg text-left hover:bg-gray-50"
                      >
                        <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} size={36} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{item.description}</p>
                          <p className="text-[10px] text-gray-400">{item.department} · {fmtPrice(item.sellPrice)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!manualLoading && manualSearch.trim() && manualResults.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">No products found</p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                {/* Selected product */}
                <div className="flex items-center gap-2.5 p-2.5 bg-violet-50 rounded-lg">
                  <ProductImage itemCode={manualSelected.itemCode} description={manualSelected.description} department={manualSelected.department} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{manualSelected.description}</p>
                    <p className="text-[10px] text-gray-400">{manualSelected.department}</p>
                  </div>
                  <button onClick={() => setManualSelected(null)} className="text-gray-400 p-1"><X size={14} /></button>
                </div>

                {/* Price inputs */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium">Normal Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={manualNormalPrice}
                      onChange={e => setManualNormalPrice(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium">Promo Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={manualPromoPrice}
                      onChange={e => setManualPromoPrice(e.target.value)}
                      placeholder="Enter promo price"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>

                {/* Date inputs */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium">Start Date</label>
                    <input
                      type="date"
                      value={manualStartDate}
                      onChange={e => setManualStartDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium">End Date</label>
                    <input
                      type="date"
                      value={manualEndDate}
                      onChange={e => setManualEndDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>

                {/* Discount preview */}
                {manualPromoPrice && manualNormalPrice && (
                  <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 flex items-center justify-between">
                    <span>Discount</span>
                    <span className="text-green-600 font-medium">
                      {((1 - parseFloat(manualPromoPrice) / parseFloat(manualNormalPrice)) * 100).toFixed(1)}% off
                    </span>
                  </div>
                )}

                {manualStartDate && parseDate(manualStartDate) > new Date() && (
                  <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 flex items-center gap-1.5">
                    <Calendar size={12} />
                    This promotion hasn't started yet — it will be tracked as upcoming
                  </div>
                )}

                <button
                  onClick={handleManualSave}
                  disabled={manualSaving || !manualPromoPrice || !manualStartDate || !manualEndDate}
                  className="w-full py-2 bg-violet-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  {manualSaving ? 'Saving...' : 'Track This Promotion'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PromoStatusBadge({ status, endDate }: { status: TrackedPromo['status']; endDate: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const endDateClean = endDate?.slice(0, 10) ?? ''
  if (status === 'ended' || (status === 'active' && endDateClean && endDateClean < today)) return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
      Ended
    </span>
  )
  if (status === 'completed') return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-500">
      <CheckCircle size={10} /> Reviewed
    </span>
  )
  const daysLeft = Math.ceil((parseDate(endDate).getTime() - Date.now()) / 86400000)
  const color = daysLeft <= 2 ? 'bg-red-100 text-red-600' : daysLeft <= 5 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${color}`}>
      {daysLeft <= 0 ? 'Last day' : `${daysLeft}d left`}
    </span>
  )
}

function PromoDetail({ item, onBack, onUpdate }: {
  item: TrackedPromo
  onBack: () => void
  onUpdate: () => void
}) {
  const [salesData, setSalesData] = useState<ItemSalesData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const sales = await getItemSales(item.itemCode, 90).catch(() => null)
        if (cancelled) return
        setSalesData(sales)

        // Auto-mark ended
        const today = new Date().toISOString().slice(0, 10)
        if (item.status === 'active' && item.endDate && item.endDate.slice(0, 10) < today) {
          await db.trackedPromos.update(item.id!, { status: 'ended' })
          onUpdate()
        }
      } catch { /* API error */ }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [item.itemCode, item.id])

  const [chartMode, setChartMode] = useState<ChartMode>('weekly')
  const { beforeSales, afterSales, chartData, changeDateLabel } = computeSalesImpact(salesData?.dailySales ?? [], item.startDate, chartMode)

  const today = new Date().toISOString().slice(0, 10)
  const endDateClean = item.endDate?.slice(0, 10) ?? ''
  const isActive = item.status === 'active' && endDateClean >= today
  const daysLeft = Math.max(0, Math.ceil((parseDate(item.endDate).getTime() - Date.now()) / 86400000))

  // Cost analysis
  const sellDiscount = item.normalPrice - item.promoPrice
  const costSaving = item.promoUnitCost != null ? (item.normalUnitCost - item.promoUnitCost) : 0
  const netMarginImpact = costSaving - sellDiscount // negative = margin squeezed

  // GP per unit
  const normalGpUnit = item.normalPrice - item.normalUnitCost
  const promoGpUnit = item.promoPrice - (item.promoUnitCost ?? item.normalUnitCost)

  async function handleComplete() {
    await db.trackedPromos.update(item.id!, { status: 'completed' })
    onUpdate()
    onBack()
  }

  async function handleDelete() {
    await db.trackedPromos.delete(item.id!)
    onUpdate()
    onBack()
  }

  return (
    <div className="p-4 space-y-4 overflow-auto">
      <button onClick={onBack} className="text-sm text-violet-600 flex items-center gap-1">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900 truncate">{item.description}</p>
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
              item.source === 'manual' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
            }`}>
              {item.source === 'manual' ? 'Manual' : 'System'}
            </span>
          </div>
          <p className="text-xs text-gray-400">{item.department} &middot; {item.itemCode}</p>
        </div>
        <PromoStatusBadge status={item.status} endDate={item.endDate} />
      </div>

      {/* Promo Period */}
      <div className="bg-violet-50 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Calendar size={12} className="text-violet-500" />
          <span className="text-xs font-semibold text-violet-700">Promotion Period</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-violet-600">{fmtDateFull(item.startDate)} → {fmtDateFull(item.endDate)}</span>
          {isActive && <span className="text-xs font-medium text-violet-700">{daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</span>}
        </div>
      </div>

      {/* Price & Cost Breakdown */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Price & Cost</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* Sell price */}
          <div className="bg-white rounded-lg p-2.5 space-y-1">
            <p className="text-[10px] font-bold text-green-600">SELL PRICE</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-gray-900">{fmtPrice(item.promoPrice)}</span>
              <span className="text-xs text-gray-400 line-through">{fmtPrice(item.normalPrice)}</span>
            </div>
            <p className="text-[10px] text-green-600 font-medium">{item.discountPercent.toFixed(0)}% off ({fmtPrice(sellDiscount)} saved)</p>
          </div>
          {/* Cost price */}
          <div className="bg-white rounded-lg p-2.5 space-y-1">
            <p className="text-[10px] font-bold text-blue-500">UNIT COST</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-gray-900">
                {item.promoUnitCost != null ? fmtPrice(item.promoUnitCost) : '—'}
              </span>
              <span className="text-xs text-gray-400 line-through">{fmtPrice(item.normalUnitCost)}</span>
            </div>
            {item.costSavingPercent != null && item.costSavingPercent > 0 && (
              <p className="text-[10px] text-blue-500 font-medium">{item.costSavingPercent.toFixed(1)}% CTN saving</p>
            )}
          </div>
        </div>

        {/* Margin analysis */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-gray-400">Normal GP/unit</p>
            <p className="text-sm font-semibold text-gray-600">{fmtPrice(normalGpUnit)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Promo GP/unit</p>
            <p className={`text-sm font-semibold ${promoGpUnit >= normalGpUnit ? 'text-green-600' : promoGpUnit >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
              {fmtPrice(promoGpUnit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Promo Margin</p>
            <p className={`text-sm font-semibold ${item.marginPercent >= 20 ? 'text-green-600' : item.marginPercent >= 10 ? 'text-amber-600' : 'text-red-600'}`}>
              {item.marginPercent.toFixed(1)}%
            </p>
          </div>
        </div>

        {netMarginImpact !== 0 && (
          <div className={`text-center text-[10px] font-medium px-2 py-1 rounded ${
            netMarginImpact >= 0 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
          }`}>
            {netMarginImpact >= 0
              ? `Supplier cost saving fully covers the sell price drop (+${fmtPrice(netMarginImpact)}/unit)`
              : `Net margin squeeze of ${fmtPrice(Math.abs(netMarginImpact))}/unit — need ${((sellDiscount - costSaving) / promoGpUnit * 100 + 100).toFixed(0)}%+ volume lift to break even on GP`}
          </div>
        )}
      </div>

      {/* Sales Chart */}
      {loading ? (
        <div className="flex justify-center py-6"><RefreshCw size={16} className="text-violet-400 animate-spin" /></div>
      ) : salesData && chartData.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Sales ({chartMode === 'weekly' ? 'Weekly' : 'Daily'})</h3>
            <ChartModeToggle mode={chartMode} onChange={setChartMode} />
          </div>
          <div className="h-48 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => [v.toFixed(1), chartMode === 'weekly' ? 'Wk Qty' : 'Qty']} labelFormatter={(l: string) => `Wk of ${l}`} />
                <ReferenceLine x={changeDateLabel} stroke="#7c3aed" strokeDasharray="4 4" label={{ value: 'Start', fontSize: 9, fill: '#7c3aed' }} />
                {endDateClean && endDateClean <= today && (
                  <ReferenceLine x={chartMode === 'weekly' ? fmtDate(getWeekStart(item.endDate)) : fmtDate(item.endDate)} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'End', fontSize: 9, fill: '#ef4444' }} />
                )}
                <Bar dataKey="qty" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {/* Before vs During comparison */}
      {salesData && (beforeSales.length > 0 || afterSales.length > 0) && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">
            Sales Impact {isActive ? '(pre-promo vs during)' : '(pre vs promo period)'}
          </h3>
          <ComparisonRow label="Avg Daily Qty" before={avg(beforeSales.map(s => s.qty))} after={avg(afterSales.map(s => s.qty))} format={(n) => n.toFixed(1)} />
          <ComparisonRow label="Avg Daily Revenue" before={avg(beforeSales.map(s => s.revenue))} after={avg(afterSales.map(s => s.revenue))} format={fmtPrice} />
          <ComparisonRow label="Avg Daily GP" before={avg(beforeSales.map(s => s.gp))} after={avg(afterSales.map(s => s.gp))} format={fmtPrice} />
          <ComparisonRow
            label="GP Margin"
            before={beforeSales.length > 0 && avg(beforeSales.map(s => s.revenue)) > 0 ? ((avg(beforeSales.map(s => s.gp)) / avg(beforeSales.map(s => s.revenue))) * 100) : 0}
            after={afterSales.length > 0 && avg(afterSales.map(s => s.revenue)) > 0 ? ((avg(afterSales.map(s => s.gp)) / avg(afterSales.map(s => s.revenue))) * 100) : 0}
            format={(n) => n.toFixed(1) + '%'}
            invertColor
          />
        </div>
      )}

      {/* Notes & Tags */}
      <NotesAndTags
        notes={item.notes}
        tags={item.tags ?? []}
        onSaveNotes={async (notes) => { await db.trackedPromos.update(item.id!, { notes }); onUpdate() }}
        onSaveTags={async (tags) => { await db.trackedPromos.update(item.id!, { tags }); onUpdate() }}
      />

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {(item.status === 'active' || item.status === 'ended') && (
          <button onClick={handleComplete} className="flex-1 py-2 bg-blue-50 text-blue-600 text-sm font-medium rounded-lg">
            Mark Reviewed
          </button>
        )}
        <button onClick={handleDelete} className="flex-1 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg">
          Remove
        </button>
      </div>
    </div>
  )
}

function PromoTrackingList() {
  const trackedPromos = useLiveQuery(() => db.trackedPromos.toArray(), [])
  const [showAdd, setShowAdd] = useState(false)
  const [selectedPromo, setSelectedPromo] = useState<TrackedPromo | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'ended' | 'completed'>('all')
  const [reordering, setReordering] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [, forceUpdate] = useState(0)

  const refresh = useCallback(() => forceUpdate(n => n + 1), [])

  if (!trackedPromos) return <div className="p-4 text-sm text-gray-400">Loading...</div>

  if (selectedPromo) {
    const current = trackedPromos.find(t => t.id === selectedPromo.id)
    if (current) return <PromoDetail item={current} onBack={() => setSelectedPromo(null)} onUpdate={refresh} />
    setSelectedPromo(null)
  }

  // Auto-detect ended promos
  const today = new Date().toISOString().slice(0, 10)
  const promos = trackedPromos.map(p => ({
    ...p,
    _effectiveStatus: (p.status === 'active' && p.endDate && p.endDate.slice(0, 10) < today) ? 'ended' as const : p.status,
  }))

  const sorted = sortByOrder(promos)
  let filtered = sorted.filter(p => filter === 'all' || p._effectiveStatus === filter)

  // Search within tracked promos
  if (listSearch.trim()) {
    const words = listSearch.trim().toLowerCase().split(/\s+/)
    filtered = filtered.filter(p => {
      const haystack = `${p.description} ${p.itemCode} ${(p.tags ?? []).join(' ')} ${p.notes}`.toLowerCase()
      return words.every(w => haystack.includes(w))
    })
  }

  const counts = {
    all: promos.length,
    active: promos.filter(p => p._effectiveStatus === 'active').length,
    ended: promos.filter(p => p._effectiveStatus === 'ended').length,
    completed: promos.filter(p => p._effectiveStatus === 'completed').length,
  }

  async function handleToggleReorder() {
    if (!reordering && trackedPromos) {
      await assignOrderIfNeeded('trackedPromos', trackedPromos)
    }
    setReordering(r => !r)
  }

  async function handleMove(index: number, direction: -1 | 1) {
    await swapOrder('trackedPromos', filtered, index, index + direction)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Filter tabs + reorder toggle */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 shrink-0">
        {(['all', 'active', 'ended', 'completed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
              filter === f ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {f === 'completed' ? 'Reviewed' : f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
        <button
          onClick={handleToggleReorder}
          className={`p-1.5 rounded-lg shrink-0 transition-colors ${
            reordering ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-violet-600'
          }`}
          title="Reorder items"
        >
          <ArrowUpDown size={14} />
        </button>
      </div>

      {/* Search bar */}
      {promos.length > 0 && (
        <div className="px-4 py-1.5 border-b border-gray-100 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              placeholder="Search tracked promos..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 focus:bg-white"
            />
            {listSearch && (
              <button onClick={() => setListSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
            {promos.length === 0 ? (
              <>
                <Tag size={32} className="text-gray-300" />
                <p className="text-sm text-gray-500">No promotions being tracked</p>
                <p className="text-xs text-gray-400">
                  Tap + to select promotions from live host/system promos
                </p>
              </>
            ) : listSearch.trim() ? (
              <p className="text-sm text-gray-400">No results for "{listSearch}"</p>
            ) : (
              <p className="text-sm text-gray-400">No {filter === 'completed' ? 'reviewed' : filter} promotions</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((item, idx) => (
              <div key={item.id} className="flex items-center">
                {reordering && (
                  <div className="flex flex-col pl-2 shrink-0">
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0}
                      className="p-0.5 text-gray-400 hover:text-violet-600 disabled:opacity-20"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === filtered.length - 1}
                      className="p-0.5 text-gray-400 hover:text-violet-600 disabled:opacity-20"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => !reordering && setSelectedPromo(item)}
                  className={`flex-1 flex items-center gap-3 p-3 text-left ${reordering ? '' : 'hover:bg-gray-50'}`}
                >
                  <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                        item.source === 'manual' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                      }`}>
                        {item.source === 'manual' ? 'Manual' : 'System'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400">
                        {fmtPrice(item.normalPrice)} → <span className="text-green-600 font-medium">{fmtPrice(item.promoPrice)}</span>
                      </span>
                      <span className="text-[10px] text-green-600 font-medium">{item.discountPercent.toFixed(0)}% off</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400">{fmtDate(item.startDate)} → {fmtDate(item.endDate)}</span>
                      <span className={`text-[10px] font-medium ${item.marginPercent >= 20 ? 'text-green-600' : item.marginPercent >= 10 ? 'text-amber-600' : 'text-red-600'}`}>
                        {item.marginPercent.toFixed(1)}% margin
                      </span>
                    </div>
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {item.tags.map(tag => <TagBadge key={tag} tag={tag} />)}
                      </div>
                    )}
                  </div>
                  {!reordering && <PromoStatusBadge status={item._effectiveStatus} endDate={item.endDate} />}
                </button>
              </div>
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

      {showAdd && <AddPromoSheet onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PRICE CHANGE TRACKING MODE (existing)
// ════════════════════════════════════════════════════════════════════════════

function DetectedPromos({ promos, onTrack, onDismiss, onDismissAll }: {
  promos: LivePromotion[]
  onTrack: (p: LivePromotion) => void
  onDismiss: (itemCode: string) => void
  onDismissAll: () => void
}) {
  if (promos.length === 0) return null

  return (
    <div className="bg-violet-50 border-b border-violet-100 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-violet-600" />
          <span className="text-xs font-semibold text-violet-700">
            {promos.length} new promo{promos.length !== 1 ? 's' : ''} available
          </span>
        </div>
        <button onClick={onDismissAll} className="text-[10px] text-violet-400 hover:text-violet-600">
          Dismiss all
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-auto">
        {promos.map(p => (
          <div key={p.itemCode} className="flex items-center gap-2 bg-white rounded-lg p-2">
            <ProductImage itemCode={p.itemCode} description={p.description} department={p.department} size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{p.description}</p>
              <p className="text-[10px] text-gray-400">
                {fmtPrice(p.normalPrice)} → <span className="text-green-600 font-medium">{fmtPrice(p.promoPrice)}</span>
                {' '}&middot; <span className="text-green-600">{p.discountPercent.toFixed(0)}% off</span>
                {' '}&middot; {fmtDate(p.startDate)} → {fmtDate(p.endDate)}
              </p>
            </div>
            <button
              onClick={() => onTrack(p)}
              className="px-2.5 py-1 bg-violet-600 text-white text-[10px] font-medium rounded-lg shrink-0"
            >
              Track
            </button>
            <button
              onClick={() => onDismiss(p.itemCode)}
              className="p-1 text-gray-300 hover:text-gray-500 shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

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
        itemCode: i.itemCode, barcode: i.barcode, description: i.description,
        department: i.department, sellPrice: i.sellPrice,
      })))
    } catch { setResults([]) }
    setSearching(false)
  }

  function handleScan(code: string) {
    setScannerOpen(false)
    setQuery(code)
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
          <h2 className="text-base font-semibold text-gray-900">Manual Track</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-400">For items not auto-detected from Smart Retail price changes</p>

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
                  type="number" step="0.01" value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Change Date</label>
                <input
                  type="date" value={changeDate}
                  onChange={e => setChangeDate(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
              <input
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Reason for price change..."
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <button
              onClick={handleSave} disabled={!newPrice || saving}
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

function PriceStatusBadge({ status, revertedAt }: { status: TrackedItem['status']; revertedAt: string | null }) {
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

function PriceTrackingDetail({ item, onBack, onUpdate }: {
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
      } catch { /* API error */ }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [item.itemCode, item.id])

  const [chartMode, setChartMode] = useState<ChartMode>('weekly')
  const { beforeSales, afterSales, chartData, changeDateLabel } = computeSalesImpact(salesData?.dailySales ?? [], item.changeDate, chartMode)

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
    <div className="p-4 space-y-4 overflow-auto">
      <button onClick={onBack} className="text-sm text-violet-600 flex items-center gap-1">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={48} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.description}</p>
          <p className="text-xs text-gray-400">{item.department} &middot; {item.itemCode}</p>
        </div>
        <PriceStatusBadge status={item.status} revertedAt={item.revertedAt} />
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

      {/* Sales Chart */}
      {salesData && chartData.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Sales ({chartMode === 'weekly' ? 'Weekly' : 'Daily'})</h3>
            <ChartModeToggle mode={chartMode} onChange={setChartMode} />
          </div>
          <div className="h-48 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => [v.toFixed(1), chartMode === 'weekly' ? 'Wk Qty' : 'Qty']} labelFormatter={(l: string) => chartMode === 'weekly' ? `Wk of ${l}` : l} />
                <ReferenceLine x={changeDateLabel} stroke="#7c3aed" strokeDasharray="4 4" label={{ value: 'Change', fontSize: 9, fill: '#7c3aed' }} />
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
          <ComparisonRow label="Avg Daily Qty" before={avg(beforeSales.map(s => s.qty))} after={avg(afterSales.map(s => s.qty))} format={(n) => n.toFixed(1)} />
          <ComparisonRow label="Avg Daily Revenue" before={avg(beforeSales.map(s => s.revenue))} after={avg(afterSales.map(s => s.revenue))} format={fmtPrice} />
          <ComparisonRow label="Avg Daily GP" before={avg(beforeSales.map(s => s.gp))} after={avg(afterSales.map(s => s.gp))} format={fmtPrice} />
          {salesData.avgCost > 0 && (
            <ComparisonRow
              label="GP Margin"
              before={beforeSales.length > 0 && avg(beforeSales.map(s => s.revenue)) > 0 ? ((avg(beforeSales.map(s => s.gp)) / avg(beforeSales.map(s => s.revenue))) * 100) : 0}
              after={afterSales.length > 0 && avg(afterSales.map(s => s.revenue)) > 0 ? ((avg(afterSales.map(s => s.gp)) / avg(afterSales.map(s => s.revenue))) * 100) : 0}
              format={(n) => n.toFixed(1) + '%'}
              invertColor
            />
          )}
        </div>
      )}

      {/* Notes & Tags */}
      <NotesAndTags
        notes={item.notes}
        tags={item.tags ?? []}
        onSaveNotes={async (notes) => { await db.trackedItems.update(item.id!, { notes }); onUpdate() }}
        onSaveTags={async (tags) => { await db.trackedItems.update(item.id!, { tags }); onUpdate() }}
      />

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

function PriceTrackingList() {
  const trackedItems = useLiveQuery(() => db.trackedItems.toArray(), [])
  const [filter, setFilter] = useState<'all' | 'active' | 'reverted' | 'completed'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedItem, setSelectedItem] = useState<TrackedItem | null>(null)
  const [reordering, setReordering] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [, forceUpdate] = useState(0)

  // Auto-detection: poll /promotions for new promos not yet tracked
  const [detectedPromos, setDetectedPromos] = useState<LivePromotion[]>([])
  const [dismissedCodes, setDismissedCodes] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(false)

  const refresh = useCallback(() => forceUpdate(n => n + 1), [])

  // Also check against tracked promos in Host mode to avoid duplicates
  const trackedPromoCodes = useLiveQuery(
    () => db.trackedPromos.toArray().then(items => new Set(items.map(i => i.itemCode))), []
  )

  const checkForNewPromos = useCallback(async () => {
    setChecking(true)
    try {
      const data = await getPromotions()
      const existingItemCodes = new Set((trackedItems ?? []).map(t => t.itemCode))
      const existingPromoCodes = trackedPromoCodes ?? new Set<string>()

      const newPromos = data.items.filter(p =>
        !existingItemCodes.has(p.itemCode) &&
        !existingPromoCodes.has(p.itemCode) &&
        !dismissedCodes.has(p.itemCode)
      )
      setDetectedPromos(newPromos)
    } catch {
      // API not available yet
    }
    setChecking(false)
  }, [trackedItems, trackedPromoCodes, dismissedCodes])

  useEffect(() => {
    checkForNewPromos()
  }, [])

  async function handleTrackDetectedPromo(promo: LivePromotion) {
    await db.trackedItems.add({
      itemCode: promo.itemCode,
      barcode: null,
      description: promo.description,
      department: promo.department,
      originalPrice: promo.normalPrice,
      newPrice: promo.promoPrice,
      changeDate: promo.startDate,
      notes: `From promo (${promo.discountPercent.toFixed(0)}% off)`,
      status: 'active',
      currentPrice: promo.promoPrice,
      revertedAt: null,
      createdAt: new Date(),
    })
    setDetectedPromos(prev => prev.filter(p => p.itemCode !== promo.itemCode))
  }

  function handleDismiss(itemCode: string) {
    setDismissedCodes(prev => new Set([...prev, itemCode]))
    setDetectedPromos(prev => prev.filter(p => p.itemCode !== itemCode))
  }

  function handleDismissAll() {
    setDetectedPromos([])
  }

  if (!trackedItems) return <div className="p-4 text-sm text-gray-400">Loading...</div>

  if (selectedItem) {
    const current = trackedItems.find(t => t.id === selectedItem.id)
    if (current) return <PriceTrackingDetail item={current} onBack={() => setSelectedItem(null)} onUpdate={refresh} />
    setSelectedItem(null)
  }

  const sorted = sortByOrder(trackedItems)
  let filtered = sorted.filter(t => filter === 'all' || t.status === filter)

  if (listSearch.trim()) {
    const words = listSearch.trim().toLowerCase().split(/\s+/)
    filtered = filtered.filter(t => {
      const haystack = `${t.description} ${t.itemCode} ${(t.tags ?? []).join(' ')} ${t.notes}`.toLowerCase()
      return words.every(w => haystack.includes(w))
    })
  }

  const counts = {
    all: trackedItems.length,
    active: trackedItems.filter(t => t.status === 'active').length,
    reverted: trackedItems.filter(t => t.status === 'reverted').length,
    completed: trackedItems.filter(t => t.status === 'completed').length,
  }

  async function handleToggleReorder() {
    if (!reordering && trackedItems) {
      await assignOrderIfNeeded('trackedItems', trackedItems)
    }
    setReordering(r => !r)
  }

  async function handleMove(index: number, direction: -1 | 1) {
    await swapOrder('trackedItems', filtered, index, index + direction)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Auto-detected promos banner */}
      <DetectedPromos
        promos={detectedPromos}
        onTrack={handleTrackDetectedPromo}
        onDismiss={handleDismiss}
        onDismissAll={handleDismissAll}
      />

      {/* Filter tabs + reorder toggle */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 shrink-0">
        {(['all', 'active', 'reverted', 'completed'] as const).map(f => (
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
        <button
          onClick={handleToggleReorder}
          className={`p-1.5 rounded-lg shrink-0 transition-colors ${
            reordering ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-violet-600'
          }`}
          title="Reorder items"
        >
          <ArrowUpDown size={14} />
        </button>
      </div>

      {/* Search + refresh */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100 shrink-0">
        {trackedItems.length > 0 && (
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              placeholder="Search tracked items..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 focus:bg-white"
            />
            {listSearch && (
              <button onClick={() => setListSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <button
          onClick={checkForNewPromos}
          disabled={checking}
          className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 shrink-0"
        >
          <RefreshCw size={10} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Checking...' : 'Check for new promos'}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
            {trackedItems.length === 0 ? (
              <>
                <AlertTriangle size={32} className="text-gray-300" />
                <p className="text-sm text-gray-500">No items being tracked</p>
                <p className="text-xs text-gray-400">
                  Price changes from Smart Retail will appear automatically.
                  {'\n'}Tap + to manually track an item.
                </p>
              </>
            ) : listSearch.trim() ? (
              <p className="text-sm text-gray-400">No results for "{listSearch}"</p>
            ) : (
              <p className="text-sm text-gray-400">No {filter} items</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((item, idx) => (
              <div key={item.id} className="flex items-center">
                {reordering && (
                  <div className="flex flex-col pl-2 shrink-0">
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0}
                      className="p-0.5 text-gray-400 hover:text-violet-600 disabled:opacity-20"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === filtered.length - 1}
                      className="p-0.5 text-gray-400 hover:text-violet-600 disabled:opacity-20"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => !reordering && setSelectedItem(item)}
                  className={`flex-1 flex items-center gap-3 p-3 text-left ${reordering ? '' : 'hover:bg-gray-50'}`}
                >
                  <ProductImage itemCode={item.itemCode} description={item.description} department={item.department} barcode={item.barcode} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">
                        {fmtPrice(item.originalPrice)} → <span className="text-violet-600 font-medium">{fmtPrice(item.newPrice)}</span>
                      </span>
                      <span className="text-[10px] text-gray-300">{fmtDate(item.changeDate)}</span>
                    </div>
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {item.tags.map(tag => <TagBadge key={tag} tag={tag} />)}
                      </div>
                    )}
                  </div>
                  {!reordering && <PriceStatusBadge status={item.status} revertedAt={item.revertedAt} />}
                </button>
              </div>
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

// ════════════════════════════════════════════════════════════════════════════
// MAIN VIEW — dual mode toggle
// ════════════════════════════════════════════════════════════════════════════

export default function TrackingView() {
  const [mode, setMode] = useState<TrackMode>('host')

  const hostCount = useLiveQuery(() => db.trackedPromos.where('status').equals('active').count(), [])
  const userCount = useLiveQuery(() => db.trackedItems.where('status').equals('active').count(), [])

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle — prominent top navigation */}
      <div className="flex bg-gray-100 mx-4 mt-3 mb-1 rounded-xl p-1 shrink-0">
        <button
          onClick={() => setMode('host')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'host'
              ? 'bg-white text-violet-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tag size={14} />
          Host
          {(hostCount ?? 0) > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              mode === 'host' ? 'bg-violet-100 text-violet-600' : 'bg-gray-200 text-gray-500'
            }`}>{hostCount}</span>
          )}
        </button>
        <button
          onClick={() => setMode('user')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'user'
              ? 'bg-white text-violet-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <DollarSign size={14} />
          User
          {(userCount ?? 0) > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              mode === 'user' ? 'bg-violet-100 text-violet-600' : 'bg-gray-200 text-gray-500'
            }`}>{userCount}</span>
          )}
        </button>
      </div>

      {/* Description line */}
      <p className="text-[10px] text-gray-400 text-center px-4 pb-1">
        {mode === 'host'
          ? 'Track host & system promotions — monitor sales performance during promo periods'
          : 'Your tracked items — auto-detects new promos from the system'}
      </p>

      {/* Content */}
      {mode === 'host' ? <PromoTrackingList /> : <PriceTrackingList />}
    </div>
  )
}
