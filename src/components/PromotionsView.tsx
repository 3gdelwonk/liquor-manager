import { useState, useMemo } from 'react'
import { Plus, X, Tag } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import type { Promotion } from '../lib/types'

type Segment = 'active' | 'upcoming' | 'history'
type PromoType = Promotion['promoType']

const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  price_reduction: 'Price Drop',
  multibuy: 'Multibuy',
  special: 'Special',
}

const PROMO_TYPE_COLORS: Record<PromoType, string> = {
  price_reduction: 'bg-violet-100 text-violet-700',
  multibuy: 'bg-blue-100 text-blue-700',
  special: 'bg-amber-100 text-amber-700',
}

function pctOff(normal: number, promo: number): string {
  if (!normal) return ''
  return `${(((normal - promo) / normal) * 100).toFixed(0)}% off`
}

function PromoCard({ promo, onDelete, salesRecords }: { promo: Promotion; onDelete: () => void; salesRecords: { barcode: string; date: string; qtySold: number }[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const isPast = promo.endDate < today

  const lift = useMemo(() => {
    if (!isPast) return null
    const duringRecs = salesRecords.filter(r => r.barcode === promo.barcode && r.date >= promo.startDate && r.date <= promo.endDate)
    const baseBefore = salesRecords.filter(r => {
      const d30 = new Date(promo.startDate)
      d30.setDate(d30.getDate() - 30)
      const d30s = d30.toISOString().slice(0, 10)
      return r.barcode === promo.barcode && r.date >= d30s && r.date < promo.startDate
    })
    const promoDays = Math.max(1, duringRecs.length)
    const baseDays = Math.max(1, 30)
    const promoVel = duringRecs.reduce((s, r) => s + r.qtySold, 0) / promoDays
    const baseVel  = baseBefore.reduce((s, r) => s + r.qtySold, 0) / baseDays
    if (baseVel === 0) return null
    return { pct: ((promoVel - baseVel) / baseVel) * 100, promoVel, baseVel }
  }, [isPast, promo, salesRecords])

  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-gray-800 truncate">{promo.productName}</p>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${PROMO_TYPE_COLORS[promo.promoType]}`}>
              {PROMO_TYPE_LABELS[promo.promoType]}
            </span>
          </div>
          {promo.promoType === 'multibuy' && promo.multibuyQty && promo.multibuyPrice ? (
            <p className="text-sm text-gray-600 mt-0.5">Buy {promo.multibuyQty} for ${promo.multibuyPrice.toFixed(2)}</p>
          ) : (
            <p className="text-sm text-gray-600 mt-0.5">
              ${promo.promoPrice.toFixed(2)} <span className="text-gray-400 line-through">${promo.normalPrice.toFixed(2)}</span>
              {' '}<span className="text-green-600 text-xs">{pctOff(promo.normalPrice, promo.promoPrice)}</span>
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">{promo.startDate} → {promo.endDate}</p>
          {isPast && lift !== null && (
            <div className={`text-xs mt-1 font-medium ${lift.pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {lift.pct >= 0 ? '+' : ''}{lift.pct.toFixed(0)}% lift · {lift.promoVel.toFixed(2)}/d vs {lift.baseVel.toFixed(2)}/d baseline
            </div>
          )}
          {promo.notes && <p className="text-xs text-gray-400 mt-1 italic">{promo.notes}</p>}
        </div>
        <button onClick={onDelete} className="text-gray-300 hover:text-red-500 shrink-0 p-1"><X size={14} /></button>
      </div>
    </div>
  )
}

export default function PromotionsView() {
  const promotions = useLiveQuery(() => db.promotions.orderBy('startDate').reverse().toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const salesRecords = useLiveQuery(() => db.salesRecords.toArray(), [])

  const [segment, setSegment] = useState<Segment>('active')
  const [showForm, setShowForm] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const { active, upcoming, history } = useMemo(() => {
    if (!promotions) return { active: [], upcoming: [], history: [] }
    return {
      active:   promotions.filter(p => p.startDate <= today && p.endDate >= today),
      upcoming: promotions.filter(p => p.startDate > today),
      history:  promotions.filter(p => p.endDate < today),
    }
  }, [promotions, today])

  const segmentData = segment === 'active' ? active : segment === 'upcoming' ? upcoming : history

  async function deletePromo(id: number | undefined) {
    if (id) await db.promotions.delete(id)
  }

  // Form state
  const [form, setForm] = useState({
    productId: '',
    startDate: today,
    endDate: '',
    promoType: 'price_reduction' as PromoType,
    promoPrice: '',
    multibuyQty: '',
    multibuyPrice: '',
    notes: '',
  })

  const selectedProduct = useMemo(() => products?.find(p => p.id === Number(form.productId)), [products, form.productId])

  async function submitForm() {
    if (!selectedProduct || !form.startDate || !form.endDate) return
    const promo: Omit<Promotion, 'id'> = {
      productId: selectedProduct.id!,
      productName: selectedProduct.name,
      barcode: selectedProduct.barcode,
      startDate: form.startDate,
      endDate: form.endDate,
      promoType: form.promoType,
      promoPrice: Number(form.promoPrice) || selectedProduct.sellPrice,
      normalPrice: selectedProduct.sellPrice,
      multibuyQty: form.multibuyQty ? Number(form.multibuyQty) : undefined,
      multibuyPrice: form.multibuyPrice ? Number(form.multibuyPrice) : undefined,
      notes: form.notes || undefined,
      createdAt: new Date(),
    }
    await db.promotions.add(promo as Promotion)
    setShowForm(false)
    setForm({ productId: '', startDate: today, endDate: '', promoType: 'price_reduction', promoPrice: '', multibuyQty: '', multibuyPrice: '', notes: '' })
  }

  const slimSales = useMemo(() => (salesRecords ?? []).map(r => ({ barcode: r.barcode, date: r.date, qtySold: r.qtySold })), [salesRecords])

  return (
    <div className="flex flex-col h-full">
      {/* Segment nav */}
      <div className="flex border-b border-gray-100">
        {(['active', 'upcoming', 'history'] as Segment[]).map(s => (
          <button key={s} onClick={() => setSegment(s)} className={`flex-1 py-2.5 text-xs font-medium transition-colors capitalize ${segment === s ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'}`}>
            {s} {s === 'active' ? `(${active.length})` : s === 'upcoming' ? `(${upcoming.length})` : `(${history.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3 pb-8">
        {segmentData.length === 0 && !showForm && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Tag size={32} className="text-gray-200" />
            <p className="text-sm text-gray-400">No {segment} promotions</p>
          </div>
        )}
        {segmentData.map(p => (
          <PromoCard key={p.id} promo={p} onDelete={() => deletePromo(p.id)} salesRecords={slimSales} />
        ))}

        {/* Add form */}
        {showForm && (
          <div className="border border-violet-200 rounded-xl p-4 bg-violet-50 space-y-3">
            <p className="text-sm font-semibold text-violet-700">Add Promotion</p>
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-gray-500">Product</span>
                <select value={form.productId} onChange={(e) => setForm(f => ({ ...f, productId: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">Select product…</option>
                  {(products ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {selectedProduct && <p className="text-xs text-gray-500">Normal price: ${selectedProduct.sellPrice.toFixed(2)}</p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-gray-500">Start</span>
                  <input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">End</span>
                  <input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-gray-500">Promo Type</span>
                <select value={form.promoType} onChange={(e) => setForm(f => ({ ...f, promoType: e.target.value as PromoType }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="price_reduction">Price Drop</option>
                  <option value="multibuy">Multibuy</option>
                  <option value="special">Special</option>
                </select>
              </label>
              {form.promoType !== 'multibuy' && (
                <label className="block">
                  <span className="text-xs text-gray-500">Promo Price</span>
                  <input type="number" step="0.01" value={form.promoPrice} onChange={(e) => setForm(f => ({ ...f, promoPrice: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </label>
              )}
              {form.promoType === 'multibuy' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-gray-500">Buy Qty</span>
                    <input type="number" value={form.multibuyQty} onChange={(e) => setForm(f => ({ ...f, multibuyQty: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">For $</span>
                    <input type="number" step="0.01" value={form.multibuyPrice} onChange={(e) => setForm(f => ({ ...f, multibuyPrice: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  </label>
                </div>
              )}
              <label className="block">
                <span className="text-xs text-gray-500">Notes</span>
                <input type="text" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={submitForm} className="flex-1 bg-violet-600 text-white text-sm font-medium py-2 rounded-lg">Add</button>
              <button onClick={() => setShowForm(false)} className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-2 rounded-lg">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* FAB */}
      {!showForm && (
        <div className="absolute bottom-20 right-4">
          <button onClick={() => setShowForm(true)} className="w-12 h-12 rounded-full bg-violet-600 text-white shadow-lg flex items-center justify-center">
            <Plus size={20} />
          </button>
        </div>
      )}
    </div>
  )
}
