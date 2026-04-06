import { useState, useEffect, useMemo } from 'react'
import { Printer, Loader2, CheckCircle, Hash, Zap, ListPlus } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { getPrinters, getLabelStyles, type Printer as PrinterType, type LabelStyle } from '../../lib/jarvis'
import { printLabel, generateLabelQueue } from '../../lib/jarvisActions'

interface PrintLabelSheetProps {
  item: StockItem
  onClose: () => void
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PrintLabelSheet({ item, onClose }: PrintLabelSheetProps) {
  const [printers, setPrinters] = useState<PrinterType[]>([])
  const [styles, setStyles] = useState<LabelStyle[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPrinter, setSelectedPrinter] = useState<number | null>(null)
  const [selectedStyle, setSelectedStyle] = useState<number | null>(null)
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getPrinters(), getLabelStyles()])
      .then(([printerList, styleList]) => {
        const labelPrinters = printerList.filter(p => p.isLabel)
        setPrinters(labelPrinters)
        setStyles(styleList)
        const first = labelPrinters[0]
        if (first) {
          setSelectedPrinter(first.id)
          setSelectedStyle(first.defaultStyleId ?? styleList.find(s => s.printerId === first.id)?.id ?? null)
        }
      })
      .catch(() => setError('Cannot load printers'))
      .finally(() => setLoading(false))
  }, [])

  const availableStyles = useMemo(() =>
    styles.filter(s => s.printerId === selectedPrinter),
    [styles, selectedPrinter]
  )

  function handlePrinterChange(printerId: number) {
    setSelectedPrinter(printerId)
    const printer = printers.find(p => p.id === printerId)
    const defaultStyle = printer?.defaultStyleId
    const printerStyles = styles.filter(s => s.printerId === printerId)
    setSelectedStyle(defaultStyle ?? printerStyles[0]?.id ?? null)
  }

  async function handlePrint(immediate: boolean) {
    if (!item.barcode || !selectedPrinter) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // Step 1: Queue the label
      const res = await printLabel(item.barcode, {
        printerId: selectedPrinter,
        count: qty,
        styleId: selectedStyle ?? undefined,
      })
      if (!(res.success || res.ok)) {
        setError(res.message ?? 'Failed to queue label')
        return
      }

      if (immediate) {
        // Step 2: Generate & print immediately
        const gen = await generateLabelQueue('label', selectedPrinter)
        if (gen.success) {
          setResult(`${res.labelCount ?? qty} label(s) sent to printer`)
        } else {
          // Queued but generate failed
          setResult(`Queued ${res.labelCount ?? qty} label(s) — print failed: ${gen.message ?? 'unknown error'}`)
        }
      } else {
        setResult(`${res.labelCount ?? qty} label(s) added to queue`)
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

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-4 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading printers...
          </div>
        ) : (
          <>
            {/* Printer selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 uppercase">Printer</label>
              {printers.length === 0 ? (
                <p className="text-xs text-gray-400">No label printers found</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {printers.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handlePrinterChange(p.id)}
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

            {/* Label style selection */}
            {availableStyles.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 uppercase">Label Style</label>
                <div className="flex flex-wrap gap-1.5">
                  {availableStyles.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStyle(s.id)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        selectedStyle === s.id
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 uppercase">Quantity</label>
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
          </>
        )}

        {/* Action buttons */}
        {result ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-green-600">
              <CheckCircle size={16} /> {result}
            </div>
            <button onClick={onClose} className="w-full py-2.5 text-sm text-violet-600 underline">Close</button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Print Now — primary action */}
            <button
              onClick={() => handlePrint(true)}
              disabled={busy || !item.barcode || !selectedPrinter || loading}
              className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              {busy ? 'Printing...' : `Print ${qty} Label${qty > 1 ? 's' : ''} Now`}
            </button>
            {/* Queue Only — secondary action */}
            <button
              onClick={() => handlePrint(false)}
              disabled={busy || !item.barcode || !selectedPrinter || loading}
              className="w-full py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-gray-50"
            >
              <ListPlus size={16} />
              Add to Queue
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>
    </div>
  )
}
