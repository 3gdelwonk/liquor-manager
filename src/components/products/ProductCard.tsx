import { useState, useEffect } from 'react'
import {
  ChevronDown, ChevronUp, DollarSign, Tag, MapPin, Compass,
  Printer, Send, Loader2, Calendar,
  Box, Truck, BarChart3
} from 'lucide-react'
import type { StockItem, LivePromotion, OrderInfo, PosStatus } from '../../lib/jarvis'
import { getOrderInfo, getPosStatus } from '../../lib/jarvis'
import { adjustStock, sendItemToPos, printLabel } from '../../lib/jarvisActions'
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
  onAction: (action: 'price' | 'promo' | 'location' | 'scout' | 'createItem') => void
}

export default function ProductCard({ item, promo, isTracked, onAction }: ProductCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null)
  const [posStatus, setPosStatus] = useState<PosStatus | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Stock adjustment inline
  const [stockAdj, setStockAdj] = useState('')
  const [stockReason, setStockReason] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)
  const [adjResult, setAdjResult] = useState<string | null>(null)

  // Direct action states
  const [sendBusy, setSendBusy] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
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

  async function handleAdjustStock() {
    const qty = Number(stockAdj)
    if (!qty || !item.barcode) return
    setAdjBusy(true)
    setAdjResult(null)
    try {
      const res = await adjustStock(item.barcode, qty, stockReason || undefined)
      setAdjResult(res.success ? `QOH adjusted${res.newQoh !== undefined ? ` → ${res.newQoh}` : ''}` : (res.message ?? 'Failed'))
      setStockAdj('')
      setStockReason('')
    } catch (err) {
      setAdjResult((err as Error).message)
    } finally {
      setAdjBusy(false)
    }
  }

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

  async function handlePrintLabel() {
    if (!item.barcode) return
    setPrintBusy(true)
    setActionMsg(null)
    try {
      const res = await printLabel(item.barcode)
      setActionMsg(res.success ? 'Label queued' : (res.message ?? 'Failed'))
    } catch (err) {
      setActionMsg((err as Error).message)
    } finally {
      setPrintBusy(false)
    }
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
            {isTracked && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-cyan-100 text-cyan-700">TRACKING</span>}
          </div>

          {/* Order code / Item code */}
          <div className="text-[10px] text-gray-400 font-mono">
            {orderInfo?.orderCodeRaw
              ? <><span className="text-gray-500">#{orderInfo.orderCodeRaw}</span> <span className="text-gray-300">{item.itemCode}</span></>
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

          {/* Barcode stripe */}
          {item.barcode && <BarcodeStripe value={item.barcode} height={28} />}
        </div>
        <div className="text-gray-400 shrink-0 mt-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 p-3 space-y-3">
          {/* Order info + POS status (lazy loaded) */}
          {detailLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 size={14} className="animate-spin" /> Loading details...
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1.5">
              {orderInfo && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                  {orderInfo.supplier && (
                    <div className="flex items-center gap-1"><Truck size={10} className="text-gray-400" /> {orderInfo.supplier}</div>
                  )}
                  {orderInfo.orderCodeRaw && (
                    <div><span className="text-gray-400">Order:</span> <span className="font-mono font-medium">{orderInfo.orderCodeRaw}</span></div>
                  )}
                  {orderInfo.cartonQty && orderInfo.cartonCost && (
                    <div><span className="text-gray-400">Ctn:</span> {orderInfo.cartonQty} × ${fmtMoney(orderInfo.unitCost ?? 0)} (${fmtMoney(orderInfo.cartonCost)})</div>
                  )}
                </div>
              )}
              {posStatus && (
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-medium ${posStatus.needsFullSend ? 'text-amber-600' : 'text-green-600'}`}>
                    POS: {posStatus.needsFullSend ? 'Needs send' : 'In sync'}
                  </span>
                  {posStatus.activePromo && <span className="text-violet-600">Active promo on POS</span>}
                </div>
              )}
              {/* Velocity */}
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <div className="flex items-center gap-1"><BarChart3 size={10} /> {item.avgDayQty.toFixed(1)}/day</div>
                <div>{item.avgWeekQty.toFixed(1)}/week</div>
                {item.isOnReorder && <div className="flex items-center gap-1"><Box size={10} className="text-blue-500" /> On order ({item.onOrder})</div>}
              </div>
            </div>
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

          {/* Action buttons */}
          <div className="grid grid-cols-3 gap-2">
            <ActionBtn icon={<DollarSign size={14} />} label="Change Price" onClick={() => onAction('price')} />
            <ActionBtn icon={<Tag size={14} />} label="Create Promo" onClick={() => onAction('promo')} />
            <ActionBtn icon={<MapPin size={14} />} label="Location" onClick={() => onAction('location')} />
            <ActionBtn icon={<Compass size={14} />} label="Scout" onClick={() => onAction('scout')} />
            <ActionBtn icon={<Send size={14} />} label="Send to POS" onClick={handleSendToPos} busy={sendBusy} />
            <ActionBtn icon={<Printer size={14} />} label="Print Label" onClick={handlePrintLabel} busy={printBusy} />
          </div>

          {actionMsg && (
            <p className={`text-xs text-center font-medium ${actionMsg.includes('Failed') || actionMsg.includes('JARVISmart') ? 'text-red-600' : 'text-green-600'}`}>
              {actionMsg}
            </p>
          )}

          {/* Inline stock adjustment */}
          <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Adjust Stock</p>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="+/- qty"
                value={stockAdj}
                onChange={e => setStockAdj(e.target.value)}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
              <input
                type="text"
                placeholder="Reason (optional)"
                value={stockReason}
                onChange={e => setStockReason(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
              <button
                onClick={handleAdjustStock}
                disabled={adjBusy || !stockAdj || !item.barcode}
                className="px-3 py-1.5 bg-violet-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {adjBusy ? <Loader2 size={14} className="animate-spin" /> : 'Apply'}
              </button>
            </div>
            {adjResult && (
              <p className={`text-xs font-medium ${adjResult.includes('Failed') || adjResult.includes('JARVISmart') ? 'text-red-600' : 'text-green-600'}`}>
                {adjResult}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ icon, label, onClick, busy }: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={busy}
      className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-violet-600 transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}
