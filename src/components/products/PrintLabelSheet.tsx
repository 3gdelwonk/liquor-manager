import { useState, useEffect } from 'react'
import { Printer, Loader2, CheckCircle, Hash } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { getPrinters, type Printer as PrinterType } from '../../lib/jarvis'
import { printLabel } from '../../lib/jarvisActions'

interface PrintLabelSheetProps {
  item: StockItem
  onClose: () => void
}

const LABEL_FORMATS = [
  { key: 'shelf', label: 'Shelf Label' },
  { key: 'barcode', label: 'Barcode Only' },
  { key: 'promo', label: 'Promo Tag' },
  { key: 'bin', label: 'Bin Label' },
]

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PrintLabelSheet({ item, onClose }: PrintLabelSheetProps) {
  const [printers, setPrinters] = useState<PrinterType[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(true)
  const [selectedPrinter, setSelectedPrinter] = useState<number | null>(null)
  const [format, setFormat] = useState('shelf')
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    getPrinters()
      .then(list => {
        setPrinters(list.filter(p => p.isLabel))
        // Default to first label printer
        const first = list.find(p => p.isLabel)
        if (first) setSelectedPrinter(first.id)
      })
      .catch(() => setError('Cannot load printers'))
      .finally(() => setLoadingPrinters(false))
  }, [])

  async function handlePrint() {
    if (!item.barcode) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await printLabel(item.barcode, {
        printerId: selectedPrinter ?? undefined,
        qty,
        format,
      })
      if (res.success || res.ok) {
        setResult(res.message ?? `${res.labelCount ?? qty} label(s) queued`)
      } else {
        setError(res.message ?? 'Print failed')
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
          <h2 className="text-base font-semibold text-gray-900">Print Label</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Product info */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-gray-800">{item.description}</p>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>${fmtMoney(item.sellPrice)}</span>
            {item.barcode && <span className="font-mono">{item.barcode}</span>}
          </div>
        </div>

        {/* Printer selection */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Printer</label>
          {loadingPrinters ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 size={14} className="animate-spin" /> Loading printers...
            </div>
          ) : printers.length === 0 ? (
            <p className="text-xs text-gray-400">No label printers found</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {printers.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPrinter(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    selectedPrinter === p.id
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <Printer size={14} />
                  <span className="truncate max-w-[140px]">{p.name}</span>
                  {p.queueRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Format selection */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Label Format</label>
          <div className="grid grid-cols-2 gap-2">
            {LABEL_FORMATS.map(f => (
              <button
                key={f.key}
                onClick={() => setFormat(f.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  format === f.key
                    ? 'border-violet-500 bg-violet-50 text-violet-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Quantity</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty(q => Math.max(1, q - 1))}
              className="w-9 h-9 rounded-lg border border-gray-200 text-gray-600 font-bold text-lg flex items-center justify-center hover:bg-gray-50"
            >
              -
            </button>
            <div className="flex items-center gap-1.5">
              <Hash size={14} className="text-gray-400" />
              <span className="text-lg font-semibold text-gray-800 w-8 text-center">{qty}</span>
            </div>
            <button
              onClick={() => setQty(q => Math.min(50, q + 1))}
              className="w-9 h-9 rounded-lg border border-gray-200 text-gray-600 font-bold text-lg flex items-center justify-center hover:bg-gray-50"
            >
              +
            </button>
          </div>
        </div>

        {/* Print button */}
        <button
          onClick={handlePrint}
          disabled={busy || !item.barcode || !selectedPrinter}
          className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : result ? <CheckCircle size={16} /> : <Printer size={16} />}
          {result ? 'Queued!' : busy ? 'Sending...' : `Print ${qty} Label${qty > 1 ? 's' : ''}`}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
        {result && <p className="text-xs text-green-600 font-medium text-center">{result}</p>}
      </div>
    </div>
  )
}
