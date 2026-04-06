import { useState, useEffect, useRef, useCallback } from 'react'
import { MapPin, Printer, CalendarClock, Package, ChevronDown, Loader2, CheckCircle, X, AlertTriangle } from 'lucide-react'
import type { StockItem, LivePromotion, ItemLocation } from '../../lib/jarvis'
import { getItemLocations } from '../../lib/jarvis'
import { formatItemLocation } from '../../lib/locationUtils'
import { adjustStock } from '../../lib/jarvisActions'
import { db, type ExpiryRecord } from '../../lib/db'
import ProductImage from '../ProductImage'

// ── Reason codes for QOH adjustments ──────────────────────────────────────
const REASON_CODES = ['Counted', 'Damaged', 'Received', 'Returned', 'Stolen', 'Other'] as const

interface CrewProductCardProps {
  item: StockItem
  promo: LivePromotion | undefined
  onPrintLabel: () => void
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysUntil(iso: string) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(iso + 'T00:00:00')
  return Math.ceil((target.getTime() - now.getTime()) / 86400000)
}

// ── QOH color ─────────────────────────────────────────────────────────────
function qohColor(onHand: number, reorder: number) {
  if (onHand <= 0) return 'text-red-600 bg-red-50'
  if (onHand <= reorder) return 'text-amber-600 bg-amber-50'
  return 'text-emerald-600 bg-emerald-50'
}

export default function CrewProductCard({ item, promo, onPrintLabel }: CrewProductCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [locations, setLocations] = useState<ItemLocation[]>([])
  const [expiries, setExpiries] = useState<ExpiryRecord[]>([])
  const [showAdjust, setShowAdjust] = useState(false)
  const [showExpiry, setShowExpiry] = useState(false)
  const mounted = useRef(true)
  const detailLoaded = useRef(false)

  useEffect(() => () => { mounted.current = false }, [])

  // Load details on expand
  useEffect(() => {
    if (!expanded || detailLoaded.current) return
    detailLoaded.current = true

    getItemLocations(item.itemCode)
      .then(locs => { if (mounted.current) setLocations(locs) })
      .catch(() => {})

    db.expiryRecords
      .where('itemCode').equals(item.itemCode)
      .and(r => r.status === 'active')
      .sortBy('expiryDate')
      .then(recs => { if (mounted.current) setExpiries(recs) })
      .catch(() => {})
  }, [expanded, item.itemCode])

  const nearestExpiry = expiries[0]
  const expiryDays = nearestExpiry ? daysUntil(nearestExpiry.expiryDate) : null
  const expiryUrgent = expiryDays !== null && expiryDays <= 30

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        {/* Image */}
        <div className="shrink-0">
          <ProductImage
            itemCode={item.itemCode}
            description={item.description}
            department={item.department}
            barcode={item.barcode}
            size={48}
            className="rounded-lg"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm font-semibold text-gray-800">${fmtMoney(item.sellPrice)}</span>
            {promo && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">
                PROMO ${fmtMoney(promo.promoPrice)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${qohColor(item.onHand, item.reorderLevel)}`}>
              QOH: {item.onHand}
            </span>
            {expiryUrgent && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-600">
                <AlertTriangle size={10} /> {expiryDays}d
              </span>
            )}
          </div>
        </div>

        <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-gray-100 px-3 pb-3 space-y-3">
          {/* Info grid */}
          <div className="grid grid-cols-3 gap-2 pt-3">
            <InfoCell label="Price" value={`$${fmtMoney(item.sellPrice)}`} />
            <InfoCell label="QOH" value={String(item.onHand)} highlight={item.onHand <= 0 ? 'red' : item.onHand <= item.reorderLevel ? 'amber' : 'green'} />
            <InfoCell label="Reorder At" value={String(item.reorderLevel)} />
          </div>

          {/* Promo banner */}
          {promo && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-700">On Promotion</p>
                <span className="text-[10px] text-amber-600">{promo.daysLeft}d left</span>
              </div>
              <p className="text-sm font-bold text-amber-800 mt-0.5">
                ${fmtMoney(promo.promoPrice)}
                <span className="text-xs font-normal text-amber-600 ml-1">
                  was ${fmtMoney(promo.normalPrice)} ({promo.discountPercent.toFixed(0)}% off)
                </span>
              </p>
              <p className="text-[10px] text-amber-600 mt-0.5">
                {fmtDate(promo.startDate)} — {fmtDate(promo.endDate)}
              </p>
            </div>
          )}

          {/* Location */}
          <div className="flex items-start gap-2">
            <MapPin size={14} className="text-blue-500 mt-0.5 shrink-0" />
            <div className="text-xs text-gray-600">
              {locations.length > 0
                ? locations.map(l => (
                    <span key={l.locationId} className="inline-block mr-2">
                      {formatItemLocation(l)}
                    </span>
                  ))
                : <span className="text-gray-400">No location set</span>
              }
            </div>
          </div>

          {/* Expiry dates */}
          <div className="flex items-start gap-2">
            <CalendarClock size={14} className="text-orange-500 mt-0.5 shrink-0" />
            <div className="text-xs text-gray-600 flex-1">
              {expiries.length > 0 ? (
                <div className="space-y-1">
                  {expiries.map(e => {
                    const days = daysUntil(e.expiryDate)
                    return (
                      <div key={e.id} className="flex items-center justify-between">
                        <span className={days <= 14 ? 'text-red-600 font-medium' : days <= 30 ? 'text-amber-600' : ''}>
                          {fmtDate(e.expiryDate)} {e.quantity > 1 && `(x${e.quantity})`}
                        </span>
                        <span className={`text-[10px] font-medium ${days <= 14 ? 'text-red-600' : days <= 30 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {days <= 0 ? 'EXPIRED' : `${days}d`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <span className="text-gray-400">No expiry dates</span>
              )}
            </div>
          </div>

          {/* Barcode */}
          {item.barcode && (
            <p className="text-center text-xs text-gray-400 font-mono">{item.barcode}</p>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setShowAdjust(true) }}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <Package size={14} />
              <span className="text-xs font-semibold">Adjust QOH</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowExpiry(true) }}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
            >
              <CalendarClock size={14} />
              <span className="text-xs font-semibold">Expiry</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPrintLabel() }}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <Printer size={14} />
              <span className="text-xs font-semibold">Print</span>
            </button>
          </div>
        </div>
      )}

      {/* Adjust QOH sheet */}
      {showAdjust && (
        <AdjustSheet
          item={item}
          onClose={() => setShowAdjust(false)}
        />
      )}

      {/* Expiry sheet */}
      {showExpiry && (
        <ExpirySheet
          item={item}
          expiries={expiries}
          onClose={() => setShowExpiry(false)}
          onUpdate={(updated) => setExpiries(updated)}
        />
      )}
    </div>
  )
}

// ── Info Cell ──────────────────────────────────────────────────────────────
function InfoCell({ label, value, highlight }: { label: string; value: string; highlight?: 'red' | 'amber' | 'green' }) {
  const colors = highlight === 'red' ? 'text-red-600 bg-red-50'
    : highlight === 'amber' ? 'text-amber-600 bg-amber-50'
    : highlight === 'green' ? 'text-emerald-600 bg-emerald-50'
    : 'text-gray-800 bg-gray-50'
  return (
    <div className={`rounded-lg p-2 text-center ${colors}`}>
      <p className="text-[10px] font-medium opacity-70 uppercase">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  )
}

// ── Adjust QOH Sheet ──────────────────────────────────────────────────────
function AdjustSheet({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const [newQty, setNewQty] = useState('')
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const qty = Number(newQty)
  const diff = !isNaN(qty) && newQty !== '' ? Math.round(qty) - item.onHand : null

  async function handleSubmit() {
    if (diff === null || diff === 0 || !item.barcode) return
    setBusy(true)
    setError(null)
    try {
      const reasonText = reason === 'Other' ? customReason : reason
      const res = await adjustStock(item.barcode, diff, reasonText || undefined)
      if (res.success) {
        setResult(`Updated to ${res.newQoh ?? Math.round(qty)}`)
      } else {
        setError(res.message ?? 'Failed')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-5 space-y-4 pb-safe">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Adjust Stock</h2>
          <button onClick={onClose} className="text-gray-400"><X size={18} /></button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-sm font-medium text-gray-800 truncate">{item.description}</p>
          <p className="text-xs text-gray-500">Current QOH: <strong>{item.onHand}</strong></p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase">New Physical Quantity</label>
          <input
            type="number"
            step="1"
            min="0"
            value={newQty}
            onChange={e => setNewQty(e.target.value)}
            placeholder="Enter new count"
            autoFocus
            className="w-full px-3 py-3 text-lg font-semibold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
          {diff !== null && diff !== 0 && (
            <p className={`text-sm font-medium ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {diff > 0 ? '+' : ''}{diff} adjustment
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 uppercase">Reason</label>
          <div className="flex flex-wrap gap-1.5">
            {REASON_CODES.map(r => (
              <button
                key={r}
                onClick={() => setReason(reason === r ? '' : r)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  reason === r
                    ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                    : 'bg-white border-gray-200 text-gray-600'
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
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          )}
        </div>

        {result ? (
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-green-600 py-2">
            <CheckCircle size={16} /> {result}
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={busy || diff === null || diff === 0}
            className="w-full py-3 bg-emerald-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
            {busy ? 'Updating...' : 'Confirm Adjustment'}
          </button>
        )}

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}

// ── Expiry Sheet ──────────────────────────────────────────────────────────
function ExpirySheet({ item, expiries, onClose, onUpdate }: {
  item: StockItem
  expiries: ExpiryRecord[]
  onClose: () => void
  onUpdate: (records: ExpiryRecord[]) => void
}) {
  const [date, setDate] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const recs = await db.expiryRecords
      .where('itemCode').equals(item.itemCode)
      .and(r => r.status === 'active')
      .sortBy('expiryDate')
    onUpdate(recs)
  }, [item.itemCode, onUpdate])

  async function handleAdd() {
    if (!date) return
    setBusy(true)
    try {
      await db.expiryRecords.add({
        itemCode: item.itemCode,
        barcode: item.barcode,
        description: item.description,
        department: item.department,
        expiryDate: date,
        quantity: Math.max(1, Math.round(Number(quantity)) || 1),
        notes: notes.trim(),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      setDate('')
      setQuantity('1')
      setNotes('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: number) {
    await db.expiryRecords.update(id, { status: 'removed', updatedAt: new Date() })
    await reload()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-5 space-y-4 pb-safe max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Expiry Dates</h2>
          <button onClick={onClose} className="text-gray-400"><X size={18} /></button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 shrink-0">
          <p className="text-sm font-medium text-gray-800 truncate">{item.description}</p>
        </div>

        {/* Add new expiry */}
        <div className="bg-orange-50 rounded-lg p-3 space-y-2 shrink-0">
          <p className="text-[10px] font-semibold text-orange-600 uppercase">Add Expiry Date</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="flex-1 border border-orange-200 rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-orange-300"
            />
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="Qty"
              className="w-16 border border-orange-200 rounded-lg px-2 py-2 text-sm bg-white text-center focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full border border-orange-200 rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-orange-300"
          />
          <button
            onClick={handleAdd}
            disabled={busy || !date}
            className="w-full py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            {busy ? 'Adding...' : 'Add Expiry'}
          </button>
        </div>

        {/* Existing expiries */}
        <div className="flex-1 overflow-auto space-y-1.5">
          {expiries.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-4">No expiry dates recorded</p>
          ) : (
            expiries.map(e => {
              const days = daysUntil(e.expiryDate)
              const urgent = days <= 14
              const warning = days <= 30

              return (
                <div key={e.id} className={`flex items-center justify-between border rounded-lg px-3 py-2.5 ${
                  urgent ? 'border-red-200 bg-red-50' : warning ? 'border-amber-200 bg-amber-50' : 'border-gray-200'
                }`}>
                  <div>
                    <p className={`text-sm font-medium ${urgent ? 'text-red-700' : warning ? 'text-amber-700' : 'text-gray-800'}`}>
                      {fmtDate(e.expiryDate)}
                      {e.quantity > 1 && <span className="text-xs font-normal ml-1">(x{e.quantity})</span>}
                    </p>
                    <p className={`text-[10px] font-medium ${urgent ? 'text-red-600' : warning ? 'text-amber-600' : 'text-gray-400'}`}>
                      {days <= 0 ? 'EXPIRED' : `${days} days remaining`}
                    </p>
                    {e.notes && <p className="text-[10px] text-gray-400 mt-0.5">{e.notes}</p>}
                  </div>
                  <button
                    onClick={() => handleRemove(e.id!)}
                    className="text-gray-400 hover:text-red-500 shrink-0 ml-2"
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
