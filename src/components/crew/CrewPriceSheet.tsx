import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Search, X, Loader2, CheckCircle, AlertCircle, ScanBarcode,
  DollarSign, RefreshCcw, Send, Tag,
} from 'lucide-react'
import type { StockItem, PriceCheck } from '../../lib/jarvis'
import { searchItems, getItemPrice } from '../../lib/jarvis'
import { changePriceAndSend, sendItemToPos } from '../../lib/jarvisActions'
import BarcodeScanner from '../BarcodeScanner'

function barcodeVariants(code: string): string[] {
  const set = new Set([code])
  if (code.startsWith('00')) set.add(code.slice(2))
  if (code.startsWith('0')) set.add(code.slice(1))
  set.add('0' + code)
  return [...set]
}
function normBarcode(bc: string): string { return bc.replace(/^0+/, '') }

interface CrewPriceSheetProps {
  onClose: () => void
}

export default function CrewPriceSheet({ onClose }: CrewPriceSheetProps) {
  const [search, setSearch]           = useState('')
  const [serverHits, setServerHits]   = useState<StockItem[]>([])
  const serverTimer                   = useRef<ReturnType<typeof setTimeout>>()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFinding, setScanFinding] = useState(false)

  const [picked, setPicked]           = useState<StockItem | null>(null)
  const [priceInfo, setPriceInfo]     = useState<PriceCheck | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)

  const [editOpen, setEditOpen]       = useState(false)
  const [newPrice, setNewPrice]       = useState('')

  const [busy, setBusy]               = useState<null | 'change' | 'send'>(null)
  const [successMsg, setSuccessMsg]   = useState<string | null>(null)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)

  function handleSearchChange(value: string) {
    setSearch(value)
    if (serverTimer.current) clearTimeout(serverTimer.current)
    if (!value.trim()) { setServerHits([]); return }
    const trimmed = value.trim()
    const isBarcodeLike = /^\d{8,}$/.test(trimmed)
    if (isBarcodeLike) {
      searchItems(trimmed, 10, true).then(r => setServerHits(r.items)).catch(() => {})
      searchItems('0' + trimmed, 10, true).then(r => setServerHits(prev => {
        const map = new Map(prev.map(i => [i.itemCode, i]))
        for (const item of r.items) if (!map.has(item.itemCode)) map.set(item.itemCode, item)
        return [...map.values()]
      })).catch(() => {})
    } else {
      serverTimer.current = setTimeout(() => {
        searchItems(trimmed, 10, false).then(r => setServerHits(r.items)).catch(() => {})
      }, 300)
    }
  }

  const searchResults = useMemo(
    () => serverHits.filter(i => i.barcode).slice(0, 10),
    [serverHits],
  )

  const handleScan = useCallback(async (code: string) => {
    setScannerOpen(false)
    setScanFinding(true)
    try {
      let res = await searchItems(code, 10, true)
      if (res.items.length === 0) {
        for (const v of barcodeVariants(code)) {
          if (v === code) continue
          res = await searchItems(v, 10, true)
          if (res.items.length > 0) break
        }
      }
      const codeNorm = normBarcode(code)
      const found =
        res.items.find(i => i.barcode != null && normBarcode(i.barcode) === codeNorm) ??
        (res.items.length === 1 ? res.items[0] : null)
      if (found) {
        pickItem(found)
      } else {
        setSearch(code)
        setServerHits(res.items)
      }
    } catch {
      setSearch(code)
    } finally {
      setScanFinding(false)
    }
  }, [])

  const fetchPrice = useCallback(async (item: StockItem) => {
    setPriceLoading(true)
    setPriceInfo(null)
    try {
      const info = await getItemPrice(item.itemCode)
      setPriceInfo(info)
    } catch (err) {
      setErrorMsg((err as Error).message)
    } finally {
      setPriceLoading(false)
    }
  }, [])

  function pickItem(item: StockItem) {
    setPicked(item)
    setSearch('')
    setServerHits([])
    setSuccessMsg(null)
    setErrorMsg(null)
    setEditOpen(false)
    setNewPrice('')
    fetchPrice(item)
  }

  function clearPick() {
    setPicked(null)
    setPriceInfo(null)
    setSuccessMsg(null)
    setErrorMsg(null)
    setEditOpen(false)
    setNewPrice('')
  }

  useEffect(() => () => {
    if (serverTimer.current) clearTimeout(serverTimer.current)
  }, [])

  async function handleChangeAndSend() {
    if (!picked?.barcode) return
    const price = Number(newPrice)
    if (isNaN(price) || price <= 0) { setErrorMsg('Enter a valid price'); return }
    setBusy('change')
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await changePriceAndSend(picked.barcode, price)
      if (res.success) {
        setSuccessMsg(`Price updated to $${price.toFixed(2)} and sent to POS`)
        setEditOpen(false)
        setNewPrice('')
        fetchPrice(picked)
      } else {
        setErrorMsg(res.message ?? 'Failed to change price')
      }
    } catch (err) {
      setErrorMsg((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleSendToPos() {
    if (!picked?.barcode) return
    setBusy('send')
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await sendItemToPos(picked.barcode)
      if (res.success) {
        setSuccessMsg('Current price re-sent to POS')
      } else {
        setErrorMsg(res.message ?? 'Failed to send to POS')
      }
    } catch (err) {
      setErrorMsg((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const currentPrice = priceInfo?.RegSellPrice ?? picked?.sellPrice
  const prevPrice    = priceInfo?.PrevSellPrice

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <DollarSign size={18} className="text-violet-500" />
            Price / POS
          </h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Search bar */}
        {!picked && (
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Search or scan a product..."
                  className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                {search && (
                  <button onClick={() => handleSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setScannerOpen(true)}
                disabled={scanFinding}
                className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-violet-600 hover:border-violet-300 disabled:opacity-50"
                title="Scan barcode"
              >
                {scanFinding ? <Loader2 size={18} className="animate-spin" /> : <ScanBarcode size={18} />}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                {searchResults.map(item => (
                  <button
                    key={item.itemCode}
                    onClick={() => pickItem(item)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{item.description}</p>
                      <p className="text-xs text-gray-400">
                        ${item.sellPrice.toFixed(2)} · {item.barcode}
                      </p>
                    </div>
                    <span className="text-xs text-violet-600 font-medium shrink-0 ml-2">Pick</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Picked item + price panel */}
        {picked && (
          <div className="flex-1 overflow-auto px-4 pt-3 pb-2 space-y-3">
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{picked.description}</p>
                  <p className="text-xs text-gray-400">
                    {picked.itemCode} · {picked.barcode ?? 'no barcode'}
                  </p>
                </div>
                <button
                  onClick={clearPick}
                  className="text-xs text-violet-600 font-medium shrink-0 underline"
                >
                  Change
                </button>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-4">
              {priceLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 size={14} className="animate-spin" /> Loading price…
                </div>
              ) : (
                <>
                  <p className="text-[10px] font-semibold text-blue-500 uppercase mb-1">Current Price</p>
                  <p className="text-3xl font-bold text-gray-900">
                    ${currentPrice != null ? currentPrice.toFixed(2) : '—'}
                  </p>
                  {prevPrice != null && prevPrice !== currentPrice && (
                    <p className="text-xs text-gray-500 mt-1">
                      Was <span className="line-through">${prevPrice.toFixed(2)}</span>
                    </p>
                  )}
                </>
              )}
              <button
                onClick={() => fetchPrice(picked)}
                disabled={priceLoading}
                className="mt-3 text-xs text-blue-600 font-medium flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCcw size={12} /> Refresh
              </button>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {!editOpen ? (
                <button
                  onClick={() => {
                    setEditOpen(true)
                    setNewPrice(currentPrice != null ? currentPrice.toFixed(2) : '')
                  }}
                  disabled={!picked.barcode || busy !== null}
                  className="w-full py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Tag size={14} /> Change price + Send to POS
                </button>
              ) : (
                <div className="bg-violet-50 rounded-lg p-3 space-y-2">
                  <label className="text-[10px] font-semibold text-violet-600 uppercase">New price</label>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-gray-700">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newPrice}
                      onChange={e => setNewPrice(e.target.value)}
                      autoFocus
                      className="flex-1 px-2 py-1.5 text-sm font-medium border border-violet-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditOpen(false); setNewPrice('') }}
                      disabled={busy !== null}
                      className="flex-1 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleChangeAndSend}
                      disabled={busy !== null || !newPrice}
                      className="flex-1 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {busy === 'change' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Apply
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleSendToPos}
                disabled={!picked.barcode || busy !== null}
                className="w-full py-2.5 bg-white border border-violet-300 text-violet-700 text-sm font-semibold rounded-lg disabled:opacity-40 flex items-center justify-center gap-1.5"
                title="Re-send current price to POS without changing it"
              >
                {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Re-send current price to POS
              </button>
            </div>

            {successMsg && (
              <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                <CheckCircle size={12} /> {successMsg}
              </p>
            )}
            {errorMsg && (
              <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                <AlertCircle size={12} /> {errorMsg}
              </p>
            )}
          </div>
        )}

        {!picked && (
          <div className="flex-1 overflow-auto px-4 pb-4 text-center text-sm text-gray-400 pt-6">
            Scan or search to pick a product
          </div>
        )}
      </div>

      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
