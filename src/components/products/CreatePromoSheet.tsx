import { useState, useEffect } from 'react'
import { Loader2, CheckCircle, Tag, Calendar, Megaphone, Printer, Award } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { getPrinters, type Printer as PrinterType } from '../../lib/jarvis'
import { createPromo, printTalker, generateLabelQueue } from '../../lib/jarvisActions'
import { addPromoChange } from '../../lib/pendingPosChanges'

const PROMO_TYPES = [
  { key: 'iga_rewards',        label: 'IGA Rewards',       talker: 'iga_rewards' },
  { key: 'manager_specials',   label: 'Manager Special',   talker: 'manager_specials' },
  { key: 'price_reduction',    label: 'Price Reduction',   talker: 'price_reduction' },
  { key: 'multibuy',           label: 'Multi-Buy',         talker: 'multibuy' },
  { key: 'clearance',          label: 'Clearance',         talker: 'clearance' },
  { key: 'seasonal',           label: 'Seasonal',          talker: 'seasonal' },
] as const

interface CreatePromoSheetProps {
  item: StockItem
  onClose: () => void
  onSuccess: () => void
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CreatePromoSheet({ item, onClose, onSuccess }: CreatePromoSheetProps) {
  const today = new Date().toISOString().slice(0, 10)
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)

  const [promoPrice, setPromoPrice] = useState('')
  const [promoType, setPromoType] = useState('iga_rewards')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(twoWeeks)
  const [sendOffer, setSendOffer] = useState(false)
  const [printTalkerOn, setPrintTalkerOn] = useState(false)
  const [talkerPrinter, setTalkerPrinter] = useState<number | null>(null)
  const [talkerPrinters, setTalkerPrinters] = useState<PrinterType[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Load printers that support A4/talkers (not shelf-edge only)
  useEffect(() => {
    getPrinters().then(list => {
      // Printers that can print talkers — A4 printers (id 2, 3) or any non-shelf-edge
      const a4 = list.filter(p => !p.isLabel || p.isReport)
      // If none match, include all printers as fallback
      const available = a4.length > 0 ? a4 : list
      setTalkerPrinters(available)
      if (available[0]) setTalkerPrinter(available[0].id)
    }).catch(() => {})
  }, [])

  const price = Number(promoPrice)
  const discount = item.sellPrice > 0 && price > 0
    ? ((item.sellPrice - price) / item.sellPrice * 100)
    : null
  const margin = price > 0 && item.avgCost > 0
    ? ((price - item.avgCost) / price * 100)
    : null

  async function handleCreate() {
    if (!price || price <= 0 || !item.barcode || !startDate || !endDate) return
    setBusy(true)
    setError(null)
    try {
      const res = await createPromo({
        barcodes: [item.barcode],
        promoSellPrice: price,
        normalSellPrice: item.sellPrice,
        startDate,
        endDate,
        promoType,
        sendToPos: false,
        sendOffer,
      })
      if (res.success) {
        addPromoChange({
          barcode: item.barcode!,
          itemCode: item.itemCode,
          description: item.description,
          promoPrice: price,
          normalPrice: item.sellPrice,
          promoType,
          startDate,
          endDate,
        })
        const parts: string[] = [`Promotion created`]
        if (res.posSent) parts.push('sent to POS')
        if (res.offerSent) parts.push('portal updated')

        // Print talker if enabled
        if (printTalkerOn && talkerPrinter && item.barcode) {
          try {
            const talkerType = PROMO_TYPES.find(t => t.key === promoType)?.talker ?? 'manager_specials'
            const tRes = await printTalker(talkerType, [item.barcode])
            if (tRes.success) {
              const gRes = await generateLabelQueue('talker', talkerPrinter)
              parts.push(gRes.success ? 'talker printed' : 'talker queued')
            }
          } catch {
            parts.push('talker failed')
          }
        }

        setResult(parts.join(' · '))
        onSuccess()
        setTimeout(onClose, 1500)
      } else {
        setError(res.message ?? 'Failed to create promotion')
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
      <div className="relative bg-white rounded-t-2xl p-6 space-y-4 pb-safe">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Create Promotion</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Product info */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-gray-800">{item.description}</p>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Current price: <strong className="text-gray-900">${fmtMoney(item.sellPrice)}</strong></span>
            <span className="font-mono text-gray-400">{item.barcode}</span>
          </div>
        </div>

        {/* Promo price */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Promo Sell Price</label>
          <div className="relative">
            <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={promoPrice}
              onChange={e => setPromoPrice(e.target.value)}
              placeholder="0.00"
              className="w-full pl-8 pr-3 py-2.5 text-lg font-semibold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-4 text-xs">
            {discount !== null && discount > 0 && (
              <span className="font-medium text-green-600">{discount.toFixed(1)}% off</span>
            )}
            {margin !== null && (
              <span className={`font-medium ${margin < 0 ? 'text-red-600' : margin < 15 ? 'text-amber-600' : 'text-green-600'}`}>
                {margin.toFixed(1)}% margin at promo
              </span>
            )}
          </div>
        </div>

        {/* Promo type */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
            <Award size={12} /> Promotion Type
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PROMO_TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => setPromoType(t.key)}
                disabled={busy}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  promoType === t.key
                    ? 'border-violet-400 bg-violet-50 text-violet-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <Calendar size={12} /> Start
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <Calendar size={12} /> End
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-2">
          <Toggle checked={sendOffer} onChange={setSendOffer} icon={<Megaphone size={14} />} label="Update Smart Retail portal" color="violet" />
          <Toggle checked={printTalkerOn} onChange={setPrintTalkerOn} icon={<Printer size={14} />} label="Print promo talker" color="violet" />
          {printTalkerOn && talkerPrinters.length > 0 && (
            <div className="ml-14 flex flex-wrap gap-1.5">
              {talkerPrinters.map(p => (
                <button
                  key={p.id}
                  onClick={() => setTalkerPrinter(p.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                    talkerPrinter === p.id
                      ? 'border-violet-400 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={busy || !price || price <= 0 || !item.barcode || !startDate || !endDate}
          className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : result ? <CheckCircle size={16} /> : null}
          {result ? result : busy ? 'Creating...' : 'Create Promotion'}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, icon, label, color = 'violet', disabled }: {
  checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; color?: string; disabled?: boolean
}) {
  const bg = disabled ? 'bg-gray-200' : checked ? (color === 'violet' ? 'bg-violet-600' : 'bg-gray-400') : 'bg-gray-300'
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <div className="relative">
        <input type="checkbox" checked={checked} onChange={e => !disabled && onChange(e.target.checked)} className="sr-only" disabled={disabled} />
        <div className={`w-10 h-5 rounded-full transition-colors ${bg}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <div className="flex items-center gap-1.5 text-sm text-gray-700">
        {icon} {label}
      </div>
    </label>
  )
}
