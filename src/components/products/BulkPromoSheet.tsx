import { useState, useMemo, useEffect } from 'react'
import { Search, X, Loader2, CheckCircle, Tag, Calendar, Megaphone, Printer, Award } from 'lucide-react'
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

interface BulkPromoSheetProps {
  items: StockItem[]
  onClose: () => void
  onSuccess: () => void
}

interface PromoEntry {
  item: StockItem
  promoPrice: string
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BulkPromoSheet({ items, onClose, onSuccess }: BulkPromoSheetProps) {
  const today = new Date().toISOString().slice(0, 10)
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)

  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<PromoEntry[]>([])
  const [promoType, setPromoType] = useState('iga_rewards')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(twoWeeks)
  const [sendOffer, setSendOffer] = useState(false)
  const [printTalkerOn, setPrintTalkerOn] = useState(false)
  const [talkerPrinter, setTalkerPrinter] = useState<number | null>(null)
  const [talkerPrinters, setTalkerPrinters] = useState<PrinterType[]>([])
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    getPrinters().then(list => {
      const a4 = list.filter(p => !p.isLabel || p.isReport)
      const available = a4.length > 0 ? a4 : list
      setTalkerPrinters(available)
      if (available[0]) setTalkerPrinter(available[0].id)
    }).catch(() => {})
  }, [])
  const [result, setResult] = useState<{ ok: number; failed: number; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const addedCodes = useMemo(() => new Set(entries.map(e => e.item.itemCode)), [entries])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return items
      .filter(i => !addedCodes.has(i.itemCode) && i.barcode)
      .filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
      .slice(0, 10)
  }, [search, items, addedCodes])

  function addItem(item: StockItem) {
    setEntries(prev => [...prev, { item, promoPrice: '' }])
    setSearch('')
  }

  function removeItem(itemCode: string) {
    setEntries(prev => prev.filter(e => e.item.itemCode !== itemCode))
  }

  function updatePrice(itemCode: string, promoPrice: string) {
    setEntries(prev => prev.map(e =>
      e.item.itemCode === itemCode ? { ...e, promoPrice } : e
    ))
  }

  // Apply a uniform discount % to all items
  const [discountPct, setDiscountPct] = useState('')
  function applyDiscountToAll() {
    const pct = Number(discountPct)
    if (!pct || pct <= 0 || pct >= 100) return
    setEntries(prev => prev.map(e => ({
      ...e,
      promoPrice: (e.item.sellPrice * (1 - pct / 100)).toFixed(2),
    })))
  }

  async function handleCreateAll() {
    // Validate all entries have prices and barcodes
    const valid = entries.filter(e => {
      const p = Number(e.promoPrice)
      return p > 0 && e.item.barcode
    })
    if (valid.length === 0) return

    setProcessing(true)
    setError(null)
    setResult(null)

    // Group entries by promo price + normal price for batch calls
    const groupKey = (promo: number, normal: number) => `${promo}|${normal}`
    const priceGroups = new Map<string, { promoPrice: number; normalPrice: number; barcodes: string[] }>()
    for (const e of valid) {
      const p = Number(Number(e.promoPrice).toFixed(2))
      const n = e.item.sellPrice
      const key = groupKey(p, n)
      const group = priceGroups.get(key) ?? { promoPrice: p, normalPrice: n, barcodes: [] }
      group.barcodes.push(e.item.barcode!)
      priceGroups.set(key, group)
    }

    let totalOk = 0
    let totalFailed = 0
    const messages: string[] = []

    for (const [, { promoPrice: price, normalPrice, barcodes }] of priceGroups) {
      try {
        const res = await createPromo({
          barcodes,
          promoSellPrice: price,
          normalSellPrice: normalPrice,
          startDate,
          endDate,
          promoType,
          sendToPos: false,
          sendOffer,
        })
        if (res.success) {
          totalOk += res.created ?? barcodes.length
          // Queue each item for POS send
          for (const bc of barcodes) {
            const entry = valid.find(e => e.item.barcode === bc)
            if (entry) {
              addPromoChange({
                barcode: bc,
                itemCode: entry.item.itemCode,
                description: entry.item.description,
                promoPrice: price,
                normalPrice: entry.item.sellPrice,
                promoType,
                startDate,
                endDate,
              })
            }
          }
          if (res.message) messages.push(res.message)
        } else {
          totalFailed += barcodes.length
          if (res.message) messages.push(res.message)
        }
      } catch (err) {
        totalFailed += barcodes.length
        messages.push((err as Error).message)
      }
    }

    // Print talkers if enabled and promos were created
    let talkerMsg = ''
    if (printTalkerOn && talkerPrinter && totalOk > 0) {
      const successBarcodes = valid
        .filter(e => e.item.barcode)
        .map(e => e.item.barcode!)
      if (successBarcodes.length > 0) {
        try {
          const talkerType = PROMO_TYPES.find(t => t.key === promoType)?.talker ?? 'manager_specials'
          const tRes = await printTalker(talkerType, successBarcodes)
          if (tRes.success) {
            const gRes = await generateLabelQueue('talker', talkerPrinter)
            talkerMsg = gRes.success ? ' · talkers printed' : ' · talkers queued'
          } else {
            talkerMsg = ' · talker queue failed'
          }
        } catch {
          talkerMsg = ' · talker print failed'
        }
      }
    }

    setProcessing(false)
    setResult({
      ok: totalOk,
      failed: totalFailed,
      message: (messages[0] ?? `${totalOk} promotion(s) created`) + talkerMsg,
    })
    if (totalOk > 0) onSuccess()
  }

  const validCount = entries.filter(e => Number(e.promoPrice) > 0 && e.item.barcode).length

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk Create Promotions</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Shared settings */}
        <div className="px-4 pt-3 space-y-3 shrink-0 border-b border-gray-100 pb-3">
          {/* Promo type selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
              <Award size={10} /> Promotion Type
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PROMO_TYPES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setPromoType(t.key)}
                  disabled={processing}
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
              <label className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
                <Calendar size={10} /> Start
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                disabled={processing}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
                <Calendar size={10} /> End
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                disabled={processing}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          </div>

          {/* Quick discount */}
          {entries.length > 0 && !result && (
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Quick discount %</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="99"
                  value={discountPct}
                  onChange={e => setDiscountPct(e.target.value)}
                  placeholder="e.g. 15"
                  disabled={processing}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <button
                onClick={applyDiscountToAll}
                disabled={processing || !discountPct}
                className="px-3 py-1.5 bg-violet-50 text-violet-600 text-xs font-medium rounded-lg hover:bg-violet-100 disabled:opacity-50"
              >
                Apply to all
              </button>
            </div>
          )}

          {/* Toggles */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <MiniToggle checked={sendOffer} onChange={setSendOffer} icon={<Megaphone size={12} />} label="Portal" disabled={processing} />
            <MiniToggle checked={printTalkerOn} onChange={setPrintTalkerOn} icon={<Printer size={12} />} label="Talkers" disabled={processing} />
          </div>
          {printTalkerOn && talkerPrinters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {talkerPrinters.map(p => (
                <button
                  key={p.id}
                  onClick={() => setTalkerPrinter(p.id)}
                  disabled={processing}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
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

        {/* Search */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products to add..."
              className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              disabled={processing}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-auto">
              {searchResults.map(item => (
                <button
                  key={item.itemCode}
                  onClick={() => addItem(item)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{item.description}</p>
                    <p className="text-xs text-gray-400">{item.barcode} · ${fmtMoney(item.sellPrice)}</p>
                  </div>
                  <span className="text-xs text-violet-600 font-medium shrink-0 ml-2">Add</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-auto px-4 pb-2">
          {entries.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">
              Search and add products to create promotions
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => {
                const p = Number(entry.promoPrice)
                const disc = entry.item.sellPrice > 0 && p > 0
                  ? ((entry.item.sellPrice - p) / entry.item.sellPrice * 100)
                  : null

                return (
                  <div key={entry.item.itemCode} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{entry.item.description}</p>
                        <p className="text-xs text-gray-400">
                          Now ${fmtMoney(entry.item.sellPrice)}
                          {entry.item.avgCost > 0 && <> · cost ${fmtMoney(entry.item.avgCost)}</>}
                        </p>
                      </div>
                      {!processing && !result && (
                        <button onClick={() => removeItem(entry.item.itemCode)} className="text-gray-400 hover:text-red-500 shrink-0">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={entry.promoPrice}
                          onChange={e => updatePrice(entry.item.itemCode, e.target.value)}
                          placeholder="Promo price"
                          disabled={processing || !!result}
                          className="w-full pl-6 pr-2 py-1.5 text-sm font-medium border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-100"
                        />
                      </div>
                      {disc !== null && disc > 0 && (
                        <span className="text-xs font-medium text-green-600 shrink-0">{disc.toFixed(0)}% off</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 shrink-0">
          {result ? (
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-green-600 flex items-center justify-center gap-1">
                <CheckCircle size={14} />
                {result.ok} promo{result.ok !== 1 ? 's' : ''} created
                {result.failed > 0 && <span className="text-red-600"> · {result.failed} failed</span>}
              </p>
              <p className="text-xs text-gray-400">{result.message}</p>
              <button onClick={onClose} className="text-sm text-violet-600 underline">Close</button>
            </div>
          ) : (
            <button
              onClick={handleCreateAll}
              disabled={processing || validCount === 0}
              className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? (
                <><Loader2 size={16} className="animate-spin" /> Creating promotions...</>
              ) : (
                <><Tag size={16} /> Create {validCount} Promotion{validCount !== 1 ? 's' : ''}</>
              )}
            </button>
          )}

          {error && <p className="text-xs text-red-600 font-medium text-center mt-2">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function MiniToggle({ checked, onChange, icon, label, disabled, forceDisabled }: {
  checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; disabled?: boolean; forceDisabled?: boolean
}) {
  const isDisabled = disabled || forceDisabled
  return (
    <label className={`flex items-center gap-1.5 ${isDisabled && forceDisabled ? 'opacity-40' : isDisabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <div className="relative">
        <input type="checkbox" checked={checked} onChange={e => !isDisabled && onChange(e.target.checked)} className="sr-only" disabled={isDisabled} />
        <div className={`w-8 h-4 rounded-full transition-colors ${checked && !forceDisabled ? 'bg-violet-600' : 'bg-gray-300'}`} />
        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </div>
      <span className="flex items-center gap-1 text-xs text-gray-600">{icon} {label}</span>
    </label>
  )
}
