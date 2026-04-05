import { useState, useEffect } from 'react'
import {
  ChevronDown, ChevronUp, DollarSign, Tag, MapPin,
  Printer, Send, Loader2, Calendar, RefreshCw, Lock, Unlock,
  Box, Truck,
} from 'lucide-react'
import type { StockItem, LivePromotion, OrderInfo, PosStatus } from '../../lib/jarvis'
import { getOrderInfo, getPosStatus, setPriceLockLocal } from '../../lib/jarvis'
import { adjustStock, sendItemToPos, togglePriceLock } from '../../lib/jarvisActions'
import ProductImage from '../ProductImage'
import BarcodeStripe from '../BarcodeStripe'

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
  onAction: (action: 'price' | 'promo' | 'location' | 'createItem' | 'printLabel') => void
  onRefresh?: () => Promise<void>
  onToggleLock?: (locked: boolean) => void
}

export default function ProductCard({ item, promo, isTracked, onAction, onRefresh, onToggleLock }: ProductCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null)
  const [posStatus, setPosStatus] = useState<PosStatus | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)

  // Stock adjustment sheet
  const [showAdjustSheet, setShowAdjustSheet] = useState(false)

  // Direct action states
  const [sendBusy, setSendBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const status = statusLabel(item.onHand, item.reorderLevel)
  const badgeClass = DEPT_COLORS[item.department] ?? 'bg-gray-100 text-gray-600'

  // Lazy-load detail on expand
  useEffect(() => {
    if (!expanded) return
    if (orderInfo && posStatus) return
    setDetailLoading(true)
    Promise.allSettled([
      getOrderInfo(item.itemCode),
      item.barcode ? getPosStatus(item.barcode) : Promise.resolve(null),
    ]).then(([oi, ps]) => {
      if (oi.status === 'fulfilled' && oi.value) setOrderInfo(oi.value)
      if (ps.status === 'fulfilled' && ps.value) setPosStatus(ps.value as PosStatus)
    }).finally(() => setDetailLoading(false))
  }, [expanded, item.itemCode, item.barcode, orderInfo, posStatus])

  async function handleSendToPos() {
    if (!item.barcode) return
    setSendBusy(true)
    setActionMsg(null)
    try {
      const res = await sendItemToPos(item.barcode)
      setActionMsg(res.success ? 'Sent to POS' : (res.message ?? 'Failed'))
    } catch (err) {
      setActionMsg((err as Error).message)
    } finally {
      setSendBusy(false)
    }
  }

  async function handleToggleLock() {
    if (!item.barcode) return
    const newLocked = !item.priceLocked
    setLockBusy(true)
    setActionMsg(null)
    try {
      await togglePriceLock(item.barcode, newLocked)
    } catch {
      // Server may not support it yet — continue with local-only
    }
    // Always persist locally for immediate UI feedback
    setPriceLockLocal(item.barcode, newLocked)
    onToggleLock?.(newLocked)
    setActionMsg(newLocked ? 'Price locked' : 'Price unlocked')
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

          {/* Grouped action buttons */}
          <div className="flex gap-2">
            {/* Price group (green) — Change Price + Lock toggle */}
            <div className="flex rounded-lg overflow-hidden flex-1">
              <button
                onClick={(e) => { e.stopPropagation(); onAction('price') }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
              >
                <DollarSign size={14} />
                <span className="text-[11px] font-semibold">Price</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleLock() }}
                disabled={lockBusy}
                className={`px-2.5 py-2 transition-colors disabled:opacity-50 ${
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Tag size={14} />
              <span className="text-[11px] font-semibold">Promo</span>
            </button>

            {/* Location (blue) */}
            <button
              onClick={(e) => { e.stopPropagation(); onAction('location') }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <MapPin size={14} />
              <span className="text-[11px] font-semibold">Location</span>
            </button>

            {/* Print (gray) */}
            <button
              onClick={(e) => { e.stopPropagation(); onAction('printLabel') }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Printer size={14} />
              <span className="text-[11px] font-semibold">Print</span>
            </button>

            {/* Send to POS (blue) */}
            <button
              onClick={(e) => { e.stopPropagation(); handleSendToPos() }}
              disabled={sendBusy || !item.barcode}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {sendBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span className="text-[11px] font-semibold">POS</span>
            </button>
          </div>

          {/* Barcode stripe */}
          {item.barcode && <BarcodeStripe value={item.barcode} height={28} />}

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
                  setOrderInfo(null)
                  setPosStatus(null)
                } finally {
                  setRefreshing(false)
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
            setActionMsg(msg)
            setShowAdjustSheet(false)
            onRefresh?.()
          }}
        />
      )}
    </div>
  )
}

function MetricCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${color ?? 'text-gray-800'}`}>{value}</p>
      {sub}
    </div>
  )
}

const REASON_CODES = [
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
  const diff = !isNaN(qty) && newQty !== '' ? qty - item.onHand : null

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
            ? `Set QOH to ${qty} (${diff > 0 ? '+' : ''}${diff})`
            : 'Enter new quantity'}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}
