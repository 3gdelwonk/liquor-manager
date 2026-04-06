import { useState, useEffect, useRef, memo, useMemo } from 'react'
import {
  ChevronDown, ChevronUp, DollarSign, Tag, MapPin,
  Printer, Send, Loader2, Calendar, RefreshCw, Lock, Unlock,
  Box, Truck, Trash2, Plus,
} from 'lucide-react'
import type { StockItem, LivePromotion, OrderInfo, PosStatus, StockLocation, ItemLocation, LocationType } from '../../lib/jarvis'
import { getOrderInfo, getPosStatus, setPriceLockLocal, getLocations, getItemLocations, getLocationTypes } from '../../lib/jarvis'
import { adjustStock, sendItemToPos, togglePriceLock, assignItemLocation, removeItemLocation, createLocation } from '../../lib/jarvisActions'
import { flattenLocations, buildLocationTree, formatItemLocation, getTypeLabel } from '../../lib/locationUtils'
import ProductImage from '../ProductImage'
import BarcodeStripe from '../BarcodeStripe'

const DEPT_COLORS: Record<string, string> = {
  WINE:          'bg-violet-100 text-violet-700',
  SPIRITS:       'bg-blue-100 text-blue-700',
  BEER:          'bg-emerald-100 text-emerald-700',
  LIQUEURS:      'bg-amber-100 text-amber-700',
  'LIQUOR/MISC': 'bg-pink-100 text-pink-700',
}

export const REASON_CODES = [
  'Breakage',
  'Theft/Shrinkage',
  'Stocktake correction',
  'Damaged goods',
  'Staff use',
  'Promo/Sample',
  'Return to supplier',
  'Received stock',
  'Other',
]

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function fmtDateFull(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusLabel(qoh: number, reorder: number): string {
  if (qoh <= 0) return 'Out'
  if (qoh < reorder) return 'Low'
  return 'Good'
}

function statusColor(status: string): string {
  if (status === 'Out') return 'text-red-700 bg-red-100'
  if (status === 'Low') return 'text-amber-700 bg-amber-100'
  return 'text-green-700 bg-green-100'
}

function QohGauge({ qoh, min }: { qoh: number; min: number }) {
  const max = Math.max(min * 3, 10)
  const pct = Math.min(100, Math.max(0, (qoh / max) * 100))
  const minPct = Math.min(100, (min / max) * 100)
  const color = qoh <= 0 ? '#ef4444' : qoh < min ? '#f59e0b' : '#10b981'
  return (
    <div className="relative h-1.5 bg-gray-100 rounded-full mt-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      {min > 0 && <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 rounded" style={{ left: `${minPct}%` }} />}
    </div>
  )
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

interface ProductCardProps {
  item: StockItem
  promo: LivePromotion | undefined
  isTracked: boolean
  onAction: (action: 'price' | 'promo' | 'createItem' | 'printLabel') => void
  onRefresh?: () => Promise<void>
  onToggleLock?: (locked: boolean) => void
}

function ProductCard({ item, promo, isTracked, onAction, onRefresh, onToggleLock }: ProductCardProps) {
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const [expanded, setExpanded] = useState(false)
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null)
  const [posStatus, setPosStatus] = useState<PosStatus | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const detailLoaded = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)

  // Stock adjustment sheet
  const [showAdjustSheet, setShowAdjustSheet] = useState(false)

  // Location inline
  const [showLocationPanel, setShowLocationPanel] = useState(false)
  const [allLocations, setAllLocations] = useState<StockLocation[]>([])
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([])
  const [itemLocations, setItemLocations] = useState<ItemLocation[]>([])
  const [locLoading, setLocLoading] = useState(false)
  const [locBusy, setLocBusy] = useState(false)
  const [newLocName, setNewLocName] = useState('')
  const [newLocCode, setNewLocCode] = useState('')
  const [newLocTypeId, setNewLocTypeId] = useState<number>(2) // default Bay
  const [newLocParentId, setNewLocParentId] = useState<number | ''>('')
  const [selectedLocId, setSelectedLocId] = useState<number | ''>('')
  const [locMsg, setLocMsg] = useState<string | null>(null)

  // Direct action states
  const [sendBusy, setSendBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout>>()

  function flashMsg(msg: string) {
    setActionMsg(msg)
    clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => { if (mounted.current) setActionMsg(null) }, 3000)
  }

  function flashLocMsg(msg: string) {
    setLocMsg(msg)
    clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => { if (mounted.current) setLocMsg(null) }, 3000)
  }

  const status = statusLabel(item.onHand, item.reorderLevel)
  const badgeClass = DEPT_COLORS[item.department] ?? 'bg-gray-100 text-gray-600'

  // Lazy-load detail on expand (fixed: no orderInfo/posStatus in deps)
  useEffect(() => {
    if (!expanded || detailLoaded.current) return
    detailLoaded.current = true
    setDetailLoading(true)
    Promise.allSettled([
      getOrderInfo(item.itemCode),
      item.barcode ? getPosStatus(item.barcode) : Promise.resolve(null),
      getItemLocations(item.itemCode),
    ]).then(([oi, ps, locs]) => {
      if (!mounted.current) return
      if (oi.status === 'fulfilled' && oi.value) setOrderInfo(oi.value)
      if (ps.status === 'fulfilled' && ps.value) setPosStatus(ps.value as PosStatus)
      if (locs.status === 'fulfilled' && locs.value) setItemLocations(locs.value as ItemLocation[])
    }).finally(() => { if (mounted.current) setDetailLoading(false) })
  }, [expanded, item.itemCode, item.barcode])

  // Flatten hierarchical locations for dropdown
  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(allLocations)
    return flattenLocations(tree)
  }, [allLocations])

  const availableLocations = useMemo(() => {
    const assigned = new Set(itemLocations.map(il => il.locationId))
    return flatLocs.filter(l => !assigned.has(l.id))
  }, [flatLocs, itemLocations])

  // Load all locations + types when panel opens
  useEffect(() => {
    if (!showLocationPanel) return
    setLocLoading(true)
    Promise.all([getLocations(), getLocationTypes()])
      .then(([all, types]) => {
        if (!mounted.current) return
        setAllLocations(all.filter(l => l.active))
        setLocationTypes(types)
      })
      .catch(() => { if (mounted.current) flashLocMsg('Failed to load locations') })
      .finally(() => { if (mounted.current) setLocLoading(false) })
  }, [showLocationPanel])

  async function handleAssignLocation() {
    if (!selectedLocId) return
    setLocBusy(true)
    try {
      const res = await assignItemLocation(Number(selectedLocId), item.itemCode)
      if (!mounted.current) return
      if (res.success) {
        flashLocMsg('Assigned')
        const updated = await getItemLocations(item.itemCode)
        if (mounted.current) { setItemLocations(updated); setSelectedLocId('') }
      } else {
        flashLocMsg(res.message ?? 'Failed')
      }
    } catch (err) {
      if (mounted.current) flashLocMsg((err as Error).message)
    } finally {
      if (mounted.current) setLocBusy(false)
    }
  }

  async function handleCreateAndAssign() {
    if (!newLocName.trim() || !newLocCode.trim()) return
    setLocBusy(true)
    try {
      const res = await createLocation(
        newLocName.trim(),
        newLocCode.trim(),
        newLocTypeId,
        newLocParentId ? Number(newLocParentId) : undefined,
      )
      if (!mounted.current) return
      if (res.success && res.id) {
        await assignItemLocation(res.id, item.itemCode)
        if (!mounted.current) return
        flashLocMsg('Location created & assigned')
        const [all, curr] = await Promise.all([getLocations(), getItemLocations(item.itemCode)])
        if (!mounted.current) return
        setAllLocations(all.filter(l => l.active))
        setItemLocations(curr)
        setNewLocName(''); setNewLocCode(''); setNewLocParentId('')
      } else {
        flashLocMsg(res.message ?? 'Failed to create location')
      }
    } catch (err) {
      if (mounted.current) flashLocMsg((err as Error).message)
    } finally {
      if (mounted.current) setLocBusy(false)
    }
  }

  async function handleRemoveLocation(loc: ItemLocation) {
    setLocBusy(true)
    try {
      const res = await removeItemLocation(loc.locationId, item.itemCode)
      if (!mounted.current) return
      if (res.success) {
        setItemLocations(prev => prev.filter(l => l.locationId !== loc.locationId))
        flashLocMsg('Removed')
      } else {
        flashLocMsg(res.message ?? 'Failed')
      }
    } catch (err) {
      if (mounted.current) flashLocMsg((err as Error).message)
    } finally {
      if (mounted.current) setLocBusy(false)
    }
  }

  async function handleSendToPos() {
    if (!item.barcode) return
    setSendBusy(true)
    try {
      const res = await sendItemToPos(item.barcode)
      if (mounted.current) flashMsg(res.success ? 'Sent to POS' : (res.message ?? 'Failed'))
    } catch (err) {
      if (mounted.current) flashMsg((err as Error).message)
    } finally {
      if (mounted.current) setSendBusy(false)
    }
  }

  async function handleToggleLock() {
    if (!item.barcode) return
    const newLocked = !item.priceLocked
    setLockBusy(true)
    try {
      await togglePriceLock(item.barcode, newLocked)
    } catch {
      // Server may not support it yet — continue with local-only
    }
    if (!mounted.current) return
    setPriceLockLocal(item.barcode, newLocked)
    onToggleLock?.(newLocked)
    flashMsg(newLocked ? 'Price locked' : 'Price unlocked')
    setLockBusy(false)
  }

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* Collapsed summary — always visible */}
      <button className="w-full text-left p-3 flex gap-3" onClick={() => setExpanded(e => !e)}>
        <ProductImage
          itemCode={item.itemCode}
          description={item.description}
          department={item.department}
          barcode={item.barcode}
          size={56}
        />
        <div className="flex-1 min-w-0 space-y-1">
          {/* Name + badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">{item.description}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badgeClass}`}>
              {item.department}
            </span>
            {promo && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-amber-100 text-amber-700">PROMO</span>}
            {item.priceLocked && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-red-100 text-red-700 flex items-center gap-0.5"><Lock size={8} />LOCKED</span>}
            {isTracked && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-cyan-100 text-cyan-700">TRACKING</span>}
          </div>

          {/* Order code / Item code */}
          <div className="text-[10px] text-gray-400 font-mono">
            {(item.orderCode || orderInfo?.orderCodeRaw)
              ? <><span className="text-gray-500">#{item.orderCode ?? orderInfo?.orderCodeRaw}</span> <span className="text-gray-300">{item.itemCode}</span></>
              : item.itemCode}
          </div>

          {/* Price + QOH row */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900">${fmtMoney(item.sellPrice)}</span>
            {item.avgCost > 0 && <span className="text-xs text-gray-400">cost ${fmtMoney(item.avgCost)}</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor(status)}`}>{status}</span>
              <span className="text-xs text-gray-500">QOH {item.onHand}</span>
            </div>
          </div>

          <QohGauge qoh={item.onHand} min={item.reorderLevel} />
        </div>
        <div className="text-gray-400 shrink-0 mt-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 p-3 space-y-3">
          {/* Barcode stripe — centred under description */}
          {item.barcode && (
            <div className="flex justify-center">
              <BarcodeStripe value={item.barcode} height={32} />
            </div>
          )}

          {/* Metrics grid */}
          {detailLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 size={14} className="animate-spin" /> Loading details...
            </div>
          ) : (
            <>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAdjustSheet(true) }}
                    className="text-center rounded-lg py-1 -my-1 hover:bg-gray-200/60 transition-colors ring-1 ring-transparent hover:ring-gray-300"
                  >
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">QOH</p>
                    <p className={`text-sm font-semibold ${item.onHand <= 0 ? 'text-red-600' : item.onHand < item.reorderLevel ? 'text-amber-600' : 'text-green-600'}`}>{item.onHand}</p>
                    {item.isOnReorder && <span className="flex items-center justify-center gap-0.5 text-[9px] text-blue-600 font-medium mt-0.5"><Box size={8} /> On order ({item.onOrder})</span>}
                  </button>
                  <MetricCell label="Cost" value={item.avgCost > 0 ? `$${fmtMoney(item.avgCost)}` : '—'} />
                  {(() => {
                    const m = item.sellPrice > 0 && item.avgCost > 0 ? ((item.sellPrice - item.avgCost) / item.sellPrice * 100) : null
                    return (
                      <MetricCell
                        label="Margin"
                        value={m !== null ? `${m.toFixed(1)}%` : '—'}
                        color={m !== null ? marginColor(m) : undefined}
                      />
                    )
                  })()}
                  <MetricCell label="Avg/Day" value={item.avgDayQty.toFixed(1)} />
                  <MetricCell label="Avg/Week" value={item.avgWeekQty.toFixed(1)} />
                  <MetricCell label="Reorder" value={String(item.reorderLevel)} />
                </div>
              </div>

              {/* Supplier/order info — compact one-liner */}
              {orderInfo && (orderInfo.supplier || orderInfo.orderCodeRaw || orderInfo.cartonQty) && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 px-1">
                  <Truck size={10} className="text-gray-400 shrink-0" />
                  <span className="truncate">
                    {[
                      orderInfo.supplier,
                      orderInfo.orderCodeRaw && `#${orderInfo.orderCodeRaw}`,
                      orderInfo.cartonQty && orderInfo.cartonCost && `Ctn ${orderInfo.cartonQty}×$${fmtMoney(orderInfo.unitCost ?? 0)}`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}

              {/* Location summary row — tappable to open panel */}
              <button
                onClick={(e) => { e.stopPropagation(); setShowLocationPanel(p => !p) }}
                className="w-full flex items-center gap-1.5 text-xs px-1 py-1 rounded-lg hover:bg-blue-50 transition-colors text-left"
              >
                <MapPin size={10} className="text-blue-500 shrink-0" />
                {itemLocations.length > 0 ? (
                  <span className="text-gray-600">
                    {itemLocations.map(l => formatItemLocation(l)).join(' · ')}
                  </span>
                ) : (
                  <span className="text-gray-400 italic">No location set — tap to assign</span>
                )}
              </button>
            </>
          )}

          {/* Promo details (if on promotion) */}
          {promo && (
            <div className="bg-amber-50 rounded-lg px-3 py-2 space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-700">
                <Tag size={12} /> Active Promotion
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-green-700">${fmtMoney(promo.promoPrice)}</span>
                <span className="text-xs text-gray-400 line-through">${fmtMoney(promo.normalPrice)}</span>
                <span className="text-xs font-medium text-green-600">{promo.discountPercent.toFixed(0)}% off</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className={marginColor(promo.marginPercent)}>{promo.marginPercent.toFixed(1)}% margin</span>
                <span className={daysLeftColor(promo.daysLeft)}>
                  {promo.daysLeft === 0 ? 'Last day' : `${promo.daysLeft} day${promo.daysLeft !== 1 ? 's' : ''} left`}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-gray-400">
                <Calendar size={10} />
                <span>{fmtDate(promo.startDate)} → {fmtDateFull(promo.endDate)}</span>
              </div>
            </div>
          )}

          {/* Action buttons — row 1: Price, Promo, Location, Print */}
          <div className="grid grid-cols-4 gap-2">
            {/* Price group (green) — Change Price + Lock toggle */}
            <div className="flex rounded-lg overflow-hidden">
              <button
                onClick={(e) => { e.stopPropagation(); onAction('price') }}
                className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
              >
                <DollarSign size={14} />
                <span className="text-[11px] font-semibold">Price</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleLock() }}
                disabled={lockBusy}
                className={`px-2 py-2.5 transition-colors disabled:opacity-50 ${
                  item.priceLocked
                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                    : 'bg-green-50 text-green-600 hover:bg-green-100'
                } border-l border-green-200`}
              >
                {lockBusy ? <Loader2 size={12} className="animate-spin" /> : item.priceLocked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>

            {/* Promo (amber) */}
            <button
              onClick={(e) => { e.stopPropagation(); onAction('promo') }}
              className="flex items-center justify-center gap-1 py-2.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Tag size={14} />
              <span className="text-[11px] font-semibold">Promo</span>
            </button>

            {/* Location (blue) — toggles inline panel */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowLocationPanel(p => !p) }}
              className={`flex items-center justify-center gap-1 py-2.5 rounded-lg transition-colors ${
                showLocationPanel ? 'bg-blue-200 text-blue-800' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              <MapPin size={14} />
              <span className="text-[11px] font-semibold">Location</span>
            </button>

            {/* Print (gray) */}
            <button
              onClick={(e) => { e.stopPropagation(); onAction('printLabel') }}
              className="flex items-center justify-center gap-1 py-2.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Printer size={14} />
              <span className="text-[11px] font-semibold">Print</span>
            </button>
          </div>

          {/* Location inline panel */}
          {showLocationPanel && (
            <div className="bg-blue-50 rounded-lg p-3 space-y-2.5">
              {locLoading ? (
                <div className="flex items-center gap-2 text-xs text-blue-600">
                  <Loader2 size={12} className="animate-spin" /> Loading locations...
                </div>
              ) : (
                <>
                  {/* Current locations */}
                  {itemLocations.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-blue-500 uppercase">Current</p>
                      {itemLocations.map(loc => (
                        <div key={loc.locationId} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5">
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-gray-700 block truncate">
                              {formatItemLocation(loc)}
                            </span>
                            {loc.typeName && (
                              <span className="text-[10px] text-gray-400">{loc.typeName}</span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveLocation(loc) }}
                            disabled={locBusy}
                            className="p-1 text-red-400 hover:text-red-600 disabled:opacity-50 shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Assign existing location */}
                  {availableLocations.length > 0 && (
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={selectedLocId}
                        onChange={e => setSelectedLocId(e.target.value ? Number(e.target.value) : '')}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                      >
                        <option value="">Assign to location...</option>
                        {availableLocations.map(l => (
                          <option key={l.id} value={l.id}>
                            {l.path}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAssignLocation() }}
                        disabled={locBusy || !selectedLocId}
                        className="px-2.5 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                      >
                        {locBusy ? <Loader2 size={12} className="animate-spin" /> : 'Assign'}
                      </button>
                    </div>
                  )}

                  {/* Create new location */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-blue-500 uppercase flex items-center gap-1"><Plus size={10} /> New Location</p>
                    <div className="flex gap-1.5">
                      <select
                        value={newLocTypeId}
                        onChange={e => setNewLocTypeId(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="w-20 border border-blue-200 rounded-lg px-1.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                      >
                        {locationTypes.length > 0 ? locationTypes.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        )) : (
                          <>
                            <option value={4}>Zone</option>
                            <option value={1}>Aisle</option>
                            <option value={2}>Bay</option>
                            <option value={3}>Row</option>
                          </>
                        )}
                      </select>
                      <input
                        type="text"
                        value={newLocName}
                        onChange={e => setNewLocName(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Name"
                        className="flex-1 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                      />
                      <input
                        type="text"
                        value={newLocCode}
                        onChange={e => setNewLocCode(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Short code"
                        className="w-20 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <select
                        value={newLocParentId}
                        onChange={e => setNewLocParentId(e.target.value ? Number(e.target.value) : '')}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                      >
                        <option value="">No parent (top level)</option>
                        {flatLocs.map(l => (
                          <option key={l.id} value={l.id}>{l.path} ({getTypeLabel(l.typeId, l.typeName)})</option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCreateAndAssign() }}
                        disabled={locBusy || !newLocName.trim() || !newLocCode.trim()}
                        className="px-2.5 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                      >
                        {locBusy ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
                      </button>
                    </div>
                  </div>

                  {locMsg && (
                    <p className={`text-[11px] font-medium ${locMsg.includes('Failed') || locMsg.includes('fail') ? 'text-red-600' : 'text-green-600'}`}>
                      {locMsg}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Send to POS — full width */}
          <button
            onClick={(e) => { e.stopPropagation(); handleSendToPos() }}
            disabled={sendBusy || !item.barcode}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {sendBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span className="text-xs font-semibold">Send to POS</span>
          </button>

          {/* POS status + Refresh footer */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-xs">
              {posStatus && (
                <>
                  <span className={`font-medium ${posStatus.needsFullSend ? 'text-amber-600' : 'text-green-600'}`}>
                    POS: {posStatus.needsFullSend ? 'Needs send' : 'In sync'}
                  </span>
                  {posStatus.activePromo && <span className="text-violet-600">Active promo</span>}
                </>
              )}
            </div>
            <button
              onClick={async (e) => {
                e.stopPropagation()
                if (!onRefresh) return
                setRefreshing(true)
                try {
                  await onRefresh()
                  if (!mounted.current) return
                  // Reset detail so next expand re-fetches
                  detailLoaded.current = false
                  setOrderInfo(null)
                  setPosStatus(null)
                } finally {
                  if (mounted.current) setRefreshing(false)
                }
              }}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>

          {actionMsg && (
            <p className={`text-xs text-center font-medium ${actionMsg.includes('Failed') || actionMsg.includes('JARVISmart') ? 'text-red-600' : 'text-green-600'}`}>
              {actionMsg}
            </p>
          )}
        </div>
      )}

      {/* Adjust Stock bottom sheet */}
      {showAdjustSheet && (
        <AdjustStockSheet
          item={item}
          onClose={() => setShowAdjustSheet(false)}
          onSuccess={(msg) => {
            flashMsg(msg)
            setShowAdjustSheet(false)
            onRefresh?.()
          }}
        />
      )}
    </div>
  )
}

// Custom comparator — ignores callback identity changes
export default memo(ProductCard, (prev, next) =>
  prev.item.itemCode === next.item.itemCode &&
  prev.item.sellPrice === next.item.sellPrice &&
  prev.item.onHand === next.item.onHand &&
  prev.item.priceLocked === next.item.priceLocked &&
  prev.item.avgCost === next.item.avgCost &&
  prev.promo === next.promo &&
  prev.isTracked === next.isTracked
)

function MetricCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${color ?? 'text-gray-800'}`}>{value}</p>
      {sub}
    </div>
  )
}

function AdjustStockSheet({ item, onClose, onSuccess }: {
  item: StockItem
  onClose: () => void
  onSuccess: (msg: string) => void
}) {
  const [newQty, setNewQty] = useState('')
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qty = Number(newQty)
  const diff = !isNaN(qty) && newQty !== '' ? Math.round(qty) - item.onHand : null

  async function handleApply() {
    if (diff === null || diff === 0 || !item.barcode) return
    const reasonText = reason === 'Other' ? customReason : reason
    setBusy(true)
    setError(null)
    try {
      const res = await adjustStock(item.barcode, diff, reasonText || undefined)
      if (res.success) {
        onSuccess(`QOH adjusted${res.newQoh !== undefined ? ` → ${res.newQoh}` : ''}`)
      } else {
        setError(res.message ?? 'Failed to adjust stock')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-t-2xl p-5 space-y-4 pb-safe" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Adjust Stock</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Product info */}
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-sm font-medium text-gray-800 truncate">{item.description}</p>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
            <span>Current QOH: <strong className="text-gray-900">{item.onHand}</strong></span>
            <span className="font-mono text-gray-400">{item.barcode}</span>
          </div>
        </div>

        {/* New quantity input */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">New Physical Quantity</label>
          <input
            type="number"
            step="1"
            min="0"
            value={newQty}
            onChange={e => setNewQty(e.target.value)}
            placeholder="Enter actual count"
            autoFocus
            className="w-full px-3 py-2.5 text-lg font-semibold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          {diff !== null && diff !== 0 && (
            <p className={`text-xs font-medium ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
              Adjustment: {diff > 0 ? '+' : ''}{diff} unit{Math.abs(diff) !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Reason code */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Reason</label>
          <div className="flex flex-wrap gap-1.5">
            {REASON_CODES.map(r => (
              <button
                key={r}
                onClick={() => setReason(reason === r ? '' : r)}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                  reason === r
                    ? 'bg-violet-100 border-violet-300 text-violet-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {reason === 'Other' && (
            <input
              type="text"
              value={customReason}
              onChange={e => setCustomReason(e.target.value)}
              placeholder="Describe reason..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 mt-1"
            />
          )}
        </div>

        {/* Apply button */}
        <button
          onClick={handleApply}
          disabled={busy || diff === null || diff === 0 || !item.barcode}
          className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? 'Adjusting...' : diff !== null && diff !== 0
            ? `Set QOH to ${Math.round(qty)} (${diff > 0 ? '+' : ''}${diff})`
            : 'Enter new quantity'}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}
