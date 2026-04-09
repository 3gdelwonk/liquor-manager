import { useState, useEffect, useRef, memo, useMemo } from 'react'
import {
  ChevronDown, ChevronUp, DollarSign, Tag, MapPin,
  Printer, Check, Loader2, Calendar, RefreshCw, Lock, Unlock,
  Box, Truck, Trash2, Power, PowerOff,
} from 'lucide-react'
import type { StockItem, LivePromotion, OrderInfo, PosStatus, StockLocation, ItemLocation, Department } from '../../lib/jarvis'
import { getOrderInfo, getPosStatus, setPriceLockLocal, getLocations, getItemLocations, getDepartmentList } from '../../lib/jarvis'
import { adjustStock, changePriceOnly, togglePriceLock, assignItemLocation, removeItemLocation, changeDepartment, setItemActive, changeCostPrice } from '../../lib/jarvisActions'
import { addActiveChange, addSyncItem } from '../../lib/pendingPosChanges'
import { flattenLocations, buildLocationTree, formatItemLocation } from '../../lib/locationUtils'
import { LocationLevelColumn, resolveTargetLocation, hasAnyCascadeInput } from './LocationCascade'
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

// Persists location field selections across ProductCard instances within a session
const locationMemory = {
  zoneId: '' as number | '', zoneName: '', zoneCode: '',
  aisleId: '' as number | '', aisleName: '', aisleCode: '',
  bayId: '' as number | '', bayName: '', bayCode: '',
  shelfId: '' as number | '', shelfName: '', shelfCode: '',
}

interface ProductCardProps {
  item: StockItem
  promo: LivePromotion | undefined
  isTracked: boolean
  onAction: (action: 'price' | 'promo' | 'createItem' | 'printLabel') => void
  onRefresh?: () => Promise<void>
  onToggleLock?: (locked: boolean) => void
  onToggleActive?: (active: boolean) => void
  onChangeDepartment?: (departmentCode: number, department: string) => void
  onChangeCost?: (avgCost: number) => void
}

function ProductCard({ item, promo, isTracked, onAction, onRefresh, onToggleLock, onToggleActive, onChangeDepartment, onChangeCost }: ProductCardProps) {
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const [expanded, setExpanded] = useState(false)
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null)
  const [posStatus, setPosStatus] = useState<PosStatus | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const detailLoaded = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  const [activeBusy, setActiveBusy] = useState(false)

  // Stock adjustment sheet
  const [showAdjustSheet, setShowAdjustSheet] = useState(false)

  // Department change
  const [showDeptPanel, setShowDeptPanel] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [deptLoading, setDeptLoading] = useState(false)
  const [deptBusy, setDeptBusy] = useState(false)

  // Cost price inline edit
  const [editingCost, setEditingCost] = useState(false)
  const [costDraft, setCostDraft] = useState('')
  const [costBusy, setCostBusy] = useState(false)

  // Location inline
  const [showLocationPanel, setShowLocationPanel] = useState(false)
  const [allLocations, setAllLocations] = useState<StockLocation[]>([])
  const [itemLocations, setItemLocations] = useState<ItemLocation[]>([])
  const [locLoading, setLocLoading] = useState(false)
  const [locBusy, setLocBusy] = useState(false)
  const [locMsg, setLocMsg] = useState<string | null>(null)

  // Cascading location fields — initialized from session memory
  const [zoneId, _setZoneId] = useState<number | ''>(locationMemory.zoneId)
  const [zoneName, _setZoneName] = useState(locationMemory.zoneName)
  const [zoneCode, _setZoneCode] = useState(locationMemory.zoneCode)
  const [aisleId, _setAisleId] = useState<number | ''>(locationMemory.aisleId)
  const [aisleName, _setAisleName] = useState(locationMemory.aisleName)
  const [aisleCode, _setAisleCode] = useState(locationMemory.aisleCode)
  const [bayId, _setBayId] = useState<number | ''>(locationMemory.bayId)
  const [bayName, _setBayName] = useState(locationMemory.bayName)
  const [bayCode, _setBayCode] = useState(locationMemory.bayCode)
  const [shelfId, _setShelfId] = useState<number | ''>(locationMemory.shelfId)
  const [shelfName, _setShelfName] = useState(locationMemory.shelfName)
  const [shelfCode, _setShelfCode] = useState(locationMemory.shelfCode)

  // Sync helpers — persist to module memory + cascade clear children
  function setZone(id: number | '', name = '', code = '') {
    _setZoneId(id); _setZoneName(name); _setZoneCode(code)
    locationMemory.zoneId = id; locationMemory.zoneName = name; locationMemory.zoneCode = code
    // Clear children
    setAisle('', '', '')
  }
  function setAisle(id: number | '', name = '', code = '') {
    _setAisleId(id); _setAisleName(name); _setAisleCode(code)
    locationMemory.aisleId = id; locationMemory.aisleName = name; locationMemory.aisleCode = code
    setBay('', '', '')
  }
  function setBay(id: number | '', name = '', code = '') {
    _setBayId(id); _setBayName(name); _setBayCode(code)
    locationMemory.bayId = id; locationMemory.bayName = name; locationMemory.bayCode = code
    setShelf('', '', '')
  }
  function setShelf(id: number | '', name = '', code = '') {
    _setShelfId(id); _setShelfName(name); _setShelfCode(code)
    locationMemory.shelfId = id; locationMemory.shelfName = name; locationMemory.shelfCode = code
  }

  // Direct action states
  const [applyBusy, setApplyBusy] = useState(false)
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
  // When on promo, item.sellPrice may reflect the promo price — use promo.normalPrice as the true normal
  const normalPrice = promo ? promo.normalPrice : item.sellPrice

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

  // Cascading filtered lists for each hierarchy level
  const zones = useMemo(() => flatLocs.filter(l => l.typeId === 4), [flatLocs])
  const aisles = useMemo(() => {
    const all = flatLocs.filter(l => l.typeId === 1)
    return zoneId ? all.filter(l => l.parentId === zoneId) : all
  }, [flatLocs, zoneId])
  const bays = useMemo(() => {
    const all = flatLocs.filter(l => l.typeId === 2)
    return aisleId ? all.filter(l => l.parentId === aisleId) : all
  }, [flatLocs, aisleId])
  const shelves = useMemo(() => {
    const all = flatLocs.filter(l => l.typeId === 3)
    return bayId ? all.filter(l => l.parentId === bayId) : all
  }, [flatLocs, bayId])

  // Load all locations when panel opens
  useEffect(() => {
    if (!showLocationPanel) return
    setLocLoading(true)
    getLocations()
      .then(all => { if (mounted.current) setAllLocations(all.filter(l => l.active)) })
      .catch(() => { if (mounted.current) flashLocMsg('Failed to load locations') })
      .finally(() => { if (mounted.current) setLocLoading(false) })
  }, [showLocationPanel])

  async function handleAssignHierarchy() {
    setLocBusy(true)
    let walkerErrored = false
    try {
      const result = await resolveTargetLocation(
        [
          { id: zoneId, name: zoneName, code: zoneCode, typeId: 4 },
          { id: aisleId, name: aisleName, code: aisleCode, typeId: 1 },
          { id: bayId, name: bayName, code: bayCode, typeId: 2 },
          { id: shelfId, name: shelfName, code: shelfCode, typeId: 3 },
        ],
        (msg) => { walkerErrored = true; if (mounted.current) flashLocMsg(msg) },
      )
      if (!mounted.current) return
      if (!result) {
        if (!walkerErrored) flashLocMsg('Select or enter at least one location level')
        setLocBusy(false)
        return
      }

      // Update cascade state with real IDs so newly created locations appear as established picks.
      // Set from leaf→root to avoid cascade-clearing children we're about to update.
      const ids = result.resolvedIds
      if (ids[3] && shelfId === -1) setShelf(ids[3])
      if (ids[2] && bayId === -1) { _setBayId(ids[2]); _setBayName(''); _setBayCode(''); locationMemory.bayId = ids[2]; locationMemory.bayName = ''; locationMemory.bayCode = '' }
      if (ids[1] && aisleId === -1) { _setAisleId(ids[1]); _setAisleName(''); _setAisleCode(''); locationMemory.aisleId = ids[1]; locationMemory.aisleName = ''; locationMemory.aisleCode = '' }
      if (ids[4] && zoneId === -1) { _setZoneId(ids[4]); _setZoneName(''); _setZoneCode(''); locationMemory.zoneId = ids[4]; locationMemory.zoneName = ''; locationMemory.zoneCode = '' }

      const assignRes = await assignItemLocation(result.finalId, item.itemCode)
      if (!mounted.current) return
      if (assignRes.success) {
        flashLocMsg('Location assigned')
        const [all, curr] = await Promise.all([getLocations(), getItemLocations(item.itemCode)])
        if (mounted.current) {
          setAllLocations(all.filter(l => l.active))
          setItemLocations(curr)
        }
      } else {
        flashLocMsg(assignRes.message ?? 'Failed to assign')
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

  // Load departments when panel opens
  useEffect(() => {
    if (!showDeptPanel || departments.length > 0) return
    setDeptLoading(true)
    getDepartmentList()
      .then(list => { if (mounted.current) setDepartments(list) })
      .catch(() => { if (mounted.current) flashMsg('Failed to load departments') })
      .finally(() => { if (mounted.current) setDeptLoading(false) })
  }, [showDeptPanel, departments.length])

  async function handleChangeDepartment(dept: Department) {
    if (!item.barcode) return
    setDeptBusy(true)
    try {
      const res = await changeDepartment(item.barcode, dept.code, dept.name)
      if (!mounted.current) return
      if (res.success) {
        // Optimistic client update so the card reflects DB state immediately
        onChangeDepartment?.(dept.code, dept.name)
        // Queue for POS terminal sync so the FAB batch picks it up
        addSyncItem({
          barcode: item.barcode,
          itemCode: item.itemCode,
          description: item.description,
        })
        flashMsg(`Department → ${dept.name} — queued for POS`)
        setShowDeptPanel(false)
      } else {
        flashMsg(res.message ?? 'Failed to change department')
      }
    } catch (err) {
      if (mounted.current) flashMsg((err as Error).message)
    } finally {
      if (mounted.current) setDeptBusy(false)
    }
  }

  function startEditCost() {
    setCostDraft(item.avgCost > 0 ? item.avgCost.toFixed(2) : '')
    setEditingCost(true)
  }

  function cancelEditCost() {
    setEditingCost(false)
    setCostDraft('')
  }

  async function handleSaveCost() {
    if (!item.barcode) return
    const val = Number(costDraft)
    if (!(val >= 0) || Number.isNaN(val)) {
      flashMsg('Enter a valid cost')
      return
    }
    if (Math.abs(val - item.avgCost) < 0.001) {
      cancelEditCost()
      return
    }
    setCostBusy(true)
    try {
      const res = await changeCostPrice(item.barcode, val)
      if (!mounted.current) return
      if (res.success) {
        onChangeCost?.(res.avgCost ?? val)
        addSyncItem({
          barcode: item.barcode,
          itemCode: item.itemCode,
          description: item.description,
        })
        flashMsg(`Cost → $${(res.avgCost ?? val).toFixed(2)} — queued for POS`)
        setEditingCost(false)
      } else {
        flashMsg(res.message ?? 'Failed to update cost')
      }
    } catch (err) {
      if (mounted.current) flashMsg((err as Error).message)
    } finally {
      if (mounted.current) setCostBusy(false)
    }
  }

  // Apply Change: writes the current client-side state to the database (idempotent
  // price reconcile via SOAP), then queues the item for the next Send to POS batch.
  // The FAB Send to POS picks up every queued item — price changes, promos,
  // active toggles, new items, and these sync entries — and pushes them to the
  // POS terminals in one go.
  async function handleApplyChange() {
    if (!item.barcode) return
    setApplyBusy(true)
    try {
      const res = await changePriceOnly(item.barcode, item.sellPrice)
      if (!mounted.current) return
      if (res.success) {
        addSyncItem({
          barcode: item.barcode,
          itemCode: item.itemCode,
          description: item.description,
        })
        flashMsg('Applied to DB — queued for POS')
      } else {
        flashMsg(res.message ?? 'Failed')
      }
    } catch (err) {
      if (mounted.current) flashMsg((err as Error).message)
    } finally {
      if (mounted.current) setApplyBusy(false)
    }
  }

  async function handleToggleActive() {
    if (!item.barcode) return
    const oldActive = item.isActive
    const newActive = !oldActive
    setActiveBusy(true)
    try {
      const res = await setItemActive(item.barcode, newActive)
      if (!mounted.current) return
      if (res.success) {
        // Optimistic update via parent
        onToggleActive?.(newActive)
        // Queue for POS terminal sync
        addActiveChange({
          barcode: item.barcode,
          itemCode: item.itemCode,
          description: item.description,
          oldActive,
          newActive,
        })
        flashMsg(newActive ? 'Activated — queued for POS' : 'Deactivated — queued for POS')
      } else {
        flashMsg(res.message ?? 'Failed')
      }
    } catch (err) {
      if (mounted.current) flashMsg((err as Error).message)
    } finally {
      if (mounted.current) setActiveBusy(false)
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
    <div className={`border rounded-xl overflow-hidden ${item.isActive ? 'border-gray-100' : 'border-gray-300 bg-gray-50/60 opacity-75'}`}>
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
            {!item.isActive && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-gray-200 text-gray-600 flex items-center gap-0.5"><PowerOff size={8} />INACTIVE</span>}
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
            <span className="text-sm font-semibold text-gray-900">${fmtMoney(normalPrice)}</span>
            {promo && <span className="text-xs font-medium text-amber-600">${fmtMoney(promo.promoPrice)}</span>}
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
                  <MetricCell
                    label="Price"
                    value={`$${fmtMoney(normalPrice)}`}
                    sub={promo ? <span className="text-[9px] font-medium text-amber-600">Promo ${fmtMoney(promo.promoPrice)}</span> : undefined}
                  />
                  <div className="text-center" onClick={(e) => { e.stopPropagation(); if (!editingCost && !costBusy) startEditCost() }}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Cost</p>
                    {editingCost ? (
                      <div className="flex items-center gap-0.5 justify-center" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-gray-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={costDraft}
                          onChange={(e) => setCostDraft(e.target.value)}
                          autoFocus
                          disabled={costBusy}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveCost()
                            if (e.key === 'Escape') cancelEditCost()
                          }}
                          className="w-14 text-sm font-semibold text-gray-800 border border-violet-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-300"
                        />
                        <button onClick={handleSaveCost} disabled={costBusy} className="text-green-600 disabled:opacity-50">
                          {costBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        </button>
                        <button onClick={cancelEditCost} disabled={costBusy} className="text-gray-400 disabled:opacity-50">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold text-gray-800 cursor-pointer hover:text-violet-600">
                        {item.avgCost > 0 ? `$${fmtMoney(item.avgCost)}` : '—'}
                      </p>
                    )}
                  </div>
                  {(() => {
                    const m = normalPrice > 0 && item.avgCost > 0 ? ((normalPrice - item.avgCost) / normalPrice * 100) : null
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

              {/* Department — tappable to change */}
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeptPanel(p => !p) }}
                className="w-full flex items-center gap-1.5 text-xs px-1 py-1 rounded-lg hover:bg-gray-50 transition-colors text-left"
              >
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClass}`}>
                  {item.department}
                </span>
                <span className="text-gray-400">Dept {item.departmentCode}</span>
                <span className="text-gray-300 ml-auto text-[10px]">tap to change</span>
              </button>

              {/* Department change panel */}
              {showDeptPanel && (
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase">Change Department</p>
                  {deptLoading ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Loader2 size={12} className="animate-spin" /> Loading departments...
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {departments.map(d => (
                        <button
                          key={d.code}
                          onClick={(e) => { e.stopPropagation(); handleChangeDepartment(d) }}
                          disabled={deptBusy || d.code === item.departmentCode}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            d.code === item.departmentCode
                              ? 'border-violet-400 bg-violet-50 text-violet-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-white'
                          } disabled:opacity-50`}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

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

                  {/* Cascading location fields — all 4 levels always visible, gap-skipping allowed */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-blue-500 uppercase">Assign Location</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      <LocationLevelColumn
                        label="Zone"
                        options={zones}
                        selectedId={zoneId}
                        name={zoneName}
                        code={zoneCode}
                        onSelectId={(id) => setZone(id, '', '')}
                        onName={(v) => { _setZoneName(v); locationMemory.zoneName = v }}
                        onCode={(v) => { _setZoneCode(v); locationMemory.zoneCode = v }}
                        busy={locBusy}
                      />
                      <LocationLevelColumn
                        label="Aisle"
                        options={aisles}
                        selectedId={aisleId}
                        name={aisleName}
                        code={aisleCode}
                        onSelectId={(id) => setAisle(id, '', '')}
                        onName={(v) => { _setAisleName(v); locationMemory.aisleName = v }}
                        onCode={(v) => { _setAisleCode(v); locationMemory.aisleCode = v }}
                        busy={locBusy}
                      />
                      <LocationLevelColumn
                        label="Bay"
                        options={bays}
                        selectedId={bayId}
                        name={bayName}
                        code={bayCode}
                        onSelectId={(id) => setBay(id, '', '')}
                        onName={(v) => { _setBayName(v); locationMemory.bayName = v }}
                        onCode={(v) => { _setBayCode(v); locationMemory.bayCode = v }}
                        busy={locBusy}
                      />
                      <LocationLevelColumn
                        label="Row"
                        options={shelves}
                        selectedId={shelfId}
                        name={shelfName}
                        code={shelfCode}
                        onSelectId={(id) => setShelf(id, '', '')}
                        onName={(v) => { _setShelfName(v); locationMemory.shelfName = v }}
                        onCode={(v) => { _setShelfCode(v); locationMemory.shelfCode = v }}
                        busy={locBusy}
                      />
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); handleAssignHierarchy() }}
                      disabled={locBusy || !hasAnyCascadeInput([
                        { id: zoneId, name: zoneName, code: zoneCode, typeId: 4 },
                        { id: aisleId, name: aisleName, code: aisleCode, typeId: 1 },
                        { id: bayId, name: bayName, code: bayCode, typeId: 2 },
                        { id: shelfId, name: shelfName, code: shelfCode, typeId: 3 },
                      ])}
                      className="w-full py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {locBusy ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                      {locBusy ? 'Assigning...' : 'Assign Location'}
                    </button>
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

          {/* Active toggle + Apply Change — secondary actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleToggleActive() }}
              disabled={activeBusy || !item.barcode}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                item.isActive
                  ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {activeBusy
                ? <Loader2 size={14} className="animate-spin" />
                : item.isActive ? <PowerOff size={14} /> : <Power size={14} />}
              <span className="text-xs font-medium">
                {item.isActive ? 'Deactivate' : 'Activate'}
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleApplyChange() }}
              disabled={applyBusy || !item.barcode}
              className="flex items-center justify-center gap-2 py-2 rounded-lg border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
              title="Write current state to the database and queue this item for the next Send to POS batch"
            >
              {applyBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              <span className="text-xs font-medium">Apply Change</span>
            </button>
          </div>

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
  prev.item.isActive === next.item.isActive &&
  prev.item.avgCost === next.item.avgCost &&
  prev.item.department === next.item.department &&
  prev.item.departmentCode === next.item.departmentCode &&
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

