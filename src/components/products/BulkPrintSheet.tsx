import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Loader2, CheckCircle, AlertCircle, Printer, Hash, Zap, ListPlus, Trash2, RefreshCw, ScanBarcode } from 'lucide-react'
import type { StockItem } from '../../lib/jarvis'
import { getPrinters, getLabelStyles, getLabelQueue, searchItems, type Printer as PrinterType, type LabelStyle, type LabelQueueItem } from '../../lib/jarvis'
import { printLabel, generateLabelQueue, removeFromQueue } from '../../lib/jarvisActions'
import BarcodeScanner from '../BarcodeScanner'

interface BulkPrintSheetProps {
  items: StockItem[]
  onClose: () => void
}

interface PrintEntry {
  item: StockItem
  qty: number
  // pending → sending → queued (server accepted) → done (physically printed) | error
  // 'queued' means the server acknowledged the queue insert but no physical print is confirmed yet.
  status: 'pending' | 'sending' | 'queued' | 'done' | 'error'
  message?: string
}

type TabMode = 'add' | 'queue'

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BulkPrintSheet({ items, onClose }: BulkPrintSheetProps) {
  const [printers, setPrinters] = useState<PrinterType[]>([])
  const [styles, setStyles] = useState<LabelStyle[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPrinter, setSelectedPrinter] = useState<number | null>(null)
  const [selectedStyle, setSelectedStyle] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<PrintEntry[]>([])
  const [processing, setProcessing] = useState(false)
  const [done, setDone] = useState(false)
  const [printerLoadError, setPrinterLoadError] = useState<string | null>(null)
  // Physical-print verification state after stage 2 (generate).
  // null = not attempted, true = confirmed printed, false = stage 2 failed
  const [stage2Verified, setStage2Verified] = useState<boolean | null>(null)
  const [stage2Message, setStage2Message] = useState<string | null>(null)

  // Queue view
  const [tab, setTab] = useState<TabMode>('add')
  const [queueItems, setQueueItems] = useState<LabelQueueItem[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [queuePending, setQueuePending] = useState(0)
  const [printingQueue, setPrintingQueue] = useState(false)
  const [queueMsg, setQueueMsg] = useState<string | null>(null)

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
        } else {
          setPrinterLoadError('No label printers returned by JARVISmart')
        }
      })
      .catch(err => {
        console.error('[BulkPrintSheet] printer load failed:', err)
        setPrinterLoadError((err as Error).message || 'Failed to load printers')
      })
      .finally(() => setLoading(false))
  }, [])

  const availableStyles = useMemo(() =>
    styles.filter(s => s.printerId === selectedPrinter),
    [styles, selectedPrinter]
  )

  function handlePrinterChange(printerId: number) {
    setSelectedPrinter(printerId)
    const printer = printers.find(p => p.id === printerId)
    const printerStyles = styles.filter(s => s.printerId === printerId)
    setSelectedStyle(printer?.defaultStyleId ?? printerStyles[0]?.id ?? null)
  }

  // Queue loading
  async function loadQueue() {
    setQueueLoading(true)
    setQueueMsg(null)
    try {
      const q = await getLabelQueue('label', selectedPrinter ?? undefined)
      setQueueItems(q.items)
      setQueuePending(q.pending)
    } catch {
      setQueueMsg('Failed to load queue')
    } finally {
      setQueueLoading(false)
    }
  }

  // Load queue when switching to queue tab
  useEffect(() => {
    if (tab === 'queue') loadQueue()
  }, [tab, selectedPrinter])

  // Scanner
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFinding, setScanFinding] = useState(false)

  // Search & add
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
    setEntries(prev => [...prev, { item, qty: 1, status: 'pending' }])
    setSearch('')
  }

  function removeItem(itemCode: string) {
    setEntries(prev => prev.filter(e => e.item.itemCode !== itemCode))
  }

  function updateQty(itemCode: string, qty: number) {
    setEntries(prev => prev.map(e =>
      e.item.itemCode === itemCode ? { ...e, qty: Math.max(1, Math.min(50, qty)) } : e
    ))
  }

  // Barcode scanner — same lookup pattern as BulkLocationSheet
  const barcodeMap = useMemo(() => {
    const map = new Map<string, StockItem>()
    for (const i of items) if (i.barcode) map.set(i.barcode, i)
    return map
  }, [items])

  function barcodeVariants(code: string): string[] {
    const set = new Set([code])
    if (code.startsWith('00')) set.add(code.slice(2))
    if (code.startsWith('0')) set.add(code.slice(1))
    set.add('0' + code)
    return [...set]
  }

  function normBarcode(bc: string): string { return bc.replace(/^0+/, '') }

  const handleScan = useCallback(async (code: string) => {
    setScannerOpen(false)
    // 1. Local cache lookup with UPC-A / EAN-13 variants
    let local: StockItem | undefined
    for (const v of barcodeVariants(code)) {
      local = barcodeMap.get(v)
      if (local) break
    }
    if (local) {
      if (!addedCodes.has(local.itemCode)) addItem(local)
      return
    }
    // 2. Server search fallback
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
      const found = res.items.find(i => i.barcode != null && normBarcode(i.barcode) === codeNorm)
                    ?? (res.items.length === 1 ? res.items[0] : null)
      if (found && !addedCodes.has(found.itemCode)) {
        addItem(found)
      } else {
        setSearch(code)
      }
    } catch {
      setSearch(code)
    } finally {
      setScanFinding(false)
    }
  }, [barcodeMap, addedCodes])

  // Queue all entries, then optionally generate (physical print)
  async function handlePrintAll(immediate: boolean) {
    if (entries.length === 0 || !selectedPrinter) return
    setProcessing(true)
    setStage2Verified(null)
    setStage2Message(null)

    // Step 1: Queue all items. Items that succeed become 'queued', NOT 'done'.
    // 'done' is reserved for items whose physical print has been verified in Step 2.
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry.item.barcode) {
        setEntries(prev => prev.map((e, j) => j === i ? { ...e, status: 'error', message: 'No barcode' } : e))
        continue
      }

      setEntries(prev => prev.map((e, j) => j === i ? { ...e, status: 'sending' } : e))

      try {
        const res = await printLabel(entry.item.barcode, {
          printerId: selectedPrinter,
          count: entry.qty,
          styleId: selectedStyle ?? undefined,
        })
        setEntries(prev => prev.map((e, j) => j === i
          ? (res.success
              ? { ...e, status: 'queued', message: undefined }
              : { ...e, status: 'error', message: res.message ?? 'Server rejected queue insert' })
          : e
        ))
      } catch (err) {
        setEntries(prev => prev.map((e, j) => j === i
          ? { ...e, status: 'error', message: (err as Error).message }
          : e
        ))
      }
    }

    // Step 2: If "Print Now" mode, flush the queue to the physical printer and VERIFY.
    if (immediate) {
      try {
        const gen = await generateLabelQueue('label', selectedPrinter)
        if (!gen.success) {
          throw new Error(gen.message ?? 'generate returned failure')
        }
        // Verify: the label queue should have drained. If pending > 0 on our printer,
        // the server accepted the job but didn't actually push it to the hardware.
        let drainVerified = true
        let pendingAfter: number | null = null
        try {
          const q = await getLabelQueue('label', selectedPrinter)
          pendingAfter = q.pending
          if (q.pending > 0) drainVerified = false
        } catch (verifyErr) {
          console.error('[BulkPrintSheet] post-generate queue verify failed:', verifyErr)
          // Verification failed — we cannot confirm print. Treat as failure.
          drainVerified = false
          pendingAfter = -1
        }
        if (drainVerified) {
          // Physical print confirmed (or as confirmed as we can get). Flip queued → done.
          setEntries(prev => prev.map(e => e.status === 'queued' ? { ...e, status: 'done' } : e))
          setStage2Verified(true)
          setStage2Message(null)
        } else {
          const detail = pendingAfter === -1
            ? 'could not verify queue drain'
            : `${pendingAfter} label(s) still pending after flush`
          const msg = `Printer did not confirm print — ${detail}. Check printer status.`
          setEntries(prev => prev.map(e => e.status === 'queued' ? { ...e, status: 'error', message: msg } : e))
          setStage2Verified(false)
          setStage2Message(msg)
        }
      } catch (err) {
        const msg = `Queued but printer did not flush: ${(err as Error).message}`
        console.error('[BulkPrintSheet] generate failed:', err)
        setEntries(prev => prev.map(e => e.status === 'queued' ? { ...e, status: 'error', message: msg } : e))
        setStage2Verified(false)
        setStage2Message(msg)
      }
    } else {
      // "Add to Queue Only" — leave items as 'queued', do not mark as physically printed.
      setStage2Verified(null)
      setStage2Message('Items queued — not sent to printer yet. Use the Queue tab to print.')
    }

    setProcessing(false)
    setDone(true)
  }

  // Print existing queue
  async function handlePrintQueue() {
    if (!selectedPrinter) return
    setPrintingQueue(true)
    setQueueMsg(null)
    try {
      const gen = await generateLabelQueue('label', selectedPrinter)
      if (!gen.success) {
        setQueueMsg(gen.message ?? 'Print failed')
        return
      }
      // Verify the queue actually drained. Server can claim success while the
      // physical spool step fails silently.
      try {
        const q = await getLabelQueue('label', selectedPrinter)
        if (q.pending > 0) {
          setQueueMsg(`Printer did not confirm print — ${q.pending} label(s) still pending. Check printer.`)
        } else {
          setQueueMsg(`Printed ${queuePending} label(s) — queue drained`)
        }
        setQueueItems(q.items)
        setQueuePending(q.pending)
      } catch (verifyErr) {
        console.error('[BulkPrintSheet] handlePrintQueue verify failed:', verifyErr)
        setQueueMsg('Print sent but queue status could not be verified — check printer.')
      }
    } catch (err) {
      console.error('[BulkPrintSheet] handlePrintQueue threw:', err)
      setQueueMsg((err as Error).message)
    } finally {
      setPrintingQueue(false)
    }
  }

  // Remove items from queue
  async function handleRemoveFromQueue(barcodes: string[]) {
    setQueueMsg(null)
    try {
      const res = await removeFromQueue(barcodes, 'label')
      if (res.success) {
        await loadQueue()
      } else {
        setQueueMsg(res.message ?? 'Failed to remove')
      }
    } catch (err) {
      setQueueMsg((err as Error).message)
    }
  }

  const totalLabels = entries.reduce((s, e) => s + e.qty, 0)
  const doneCount = entries.filter(e => e.status === 'done').length
  const queuedCount = entries.filter(e => e.status === 'queued').length
  const errorCount = entries.filter(e => e.status === 'error').length

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk Print Labels</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Printer + Style selection */}
        <div className="px-4 pt-3 space-y-3 shrink-0 border-b border-gray-100 pb-3">
          {printerLoadError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold">Can't load printers</p>
                <p className="text-red-600 break-words">{printerLoadError}</p>
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2 justify-center">
              <Loader2 size={12} className="animate-spin" /> Loading printers...
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Printer</label>
                <div className="flex flex-wrap gap-1.5">
                  {printers.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handlePrinterChange(p.id)}
                      disabled={processing}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        selectedPrinter === p.id
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Printer size={12} />
                      <span className="truncate max-w-[120px]">{p.name}</span>
                      {p.queueRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {availableStyles.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500 uppercase">Label Style</label>
                  <div className="flex flex-wrap gap-1.5">
                    {availableStyles.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedStyle(s.id)}
                        disabled={processing}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
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
            </>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-gray-100 shrink-0">
          <button
            onClick={() => setTab('add')}
            className={`flex-1 py-2.5 text-xs font-semibold text-center transition-colors ${
              tab === 'add' ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'
            }`}
          >
            Add Items
          </button>
          <button
            onClick={() => setTab('queue')}
            className={`flex-1 py-2.5 text-xs font-semibold text-center transition-colors relative ${
              tab === 'queue' ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'
            }`}
          >
            Print Queue
            {queuePending > 0 && tab !== 'queue' && (
              <span className="absolute top-1.5 ml-1 px-1.5 py-0.5 bg-violet-100 text-violet-600 text-[10px] font-bold rounded-full">
                {queuePending}
              </span>
            )}
          </button>
        </div>

        {tab === 'add' ? (
          <>
            {/* Search to add items */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className="flex gap-2">
                <div className="relative flex-1">
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
                <button
                  onClick={() => setScannerOpen(true)}
                  disabled={processing}
                  className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-violet-600 hover:border-violet-300 disabled:opacity-50"
                  title="Scan barcode"
                >
                  {scanFinding ? <Loader2 size={18} className="animate-spin" /> : <ScanBarcode size={18} />}
                </button>
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
                  Search and add products to print labels
                </div>
              ) : (
                <div className="space-y-2">
                  {entries.map(entry => (
                    <div
                      key={entry.item.itemCode}
                      className={`border rounded-lg p-3 ${
                        entry.status === 'done' ? 'border-green-200 bg-green-50' :
                        entry.status === 'error' ? 'border-red-200 bg-red-50' :
                        entry.status === 'queued' ? 'border-amber-200 bg-amber-50' :
                        entry.status === 'sending' ? 'border-violet-200 bg-violet-50' :
                        'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{entry.item.description}</p>
                          <p className="text-xs text-gray-400">{entry.item.barcode} · ${fmtMoney(entry.item.sellPrice)}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {entry.status === 'pending' && !processing && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => updateQty(entry.item.itemCode, entry.qty - 1)}
                                className="w-6 h-6 rounded border border-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center"
                              >
                                -
                              </button>
                              <span className="text-sm font-medium text-gray-700 w-5 text-center">{entry.qty}</span>
                              <button
                                onClick={() => updateQty(entry.item.itemCode, entry.qty + 1)}
                                className="w-6 h-6 rounded border border-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center"
                              >
                                +
                              </button>
                            </div>
                          )}
                          {entry.status === 'pending' && !processing && (
                            <button onClick={() => removeItem(entry.item.itemCode)} className="text-gray-400 hover:text-red-500">
                              <X size={16} />
                            </button>
                          )}
                          {entry.status === 'done' && <CheckCircle size={16} className="text-green-500" />}
                          {entry.status === 'error' && <AlertCircle size={16} className="text-red-500" />}
                          {entry.status === 'sending' && <Loader2 size={16} className="animate-spin text-violet-500" />}
                          {entry.status === 'queued' && <ListPlus size={16} className="text-amber-600" />}
                          {(entry.status === 'done' || entry.status === 'sending' || entry.status === 'queued') && (
                            <span className="flex items-center gap-0.5 text-xs text-gray-500"><Hash size={10} />{entry.qty}</span>
                          )}
                        </div>
                      </div>
                      {entry.message && (
                        <p className={`text-xs mt-1 ${entry.status === 'error' ? 'text-red-600' : 'text-amber-700'}`}>
                          {entry.message}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer — Add tab */}
            <div className="border-t border-gray-100 p-4 shrink-0 space-y-2">
              {done ? (
                <div className="text-center space-y-1">
                  {stage2Verified === true ? (
                    <p className="text-sm font-medium text-green-600">
                      Printed {doneCount} item{doneCount !== 1 ? 's' : ''} ({totalLabels} label{totalLabels !== 1 ? 's' : ''})
                      {errorCount > 0 && <span className="text-red-600"> · {errorCount} failed</span>}
                    </p>
                  ) : stage2Verified === false ? (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                      <p className="text-sm font-semibold text-red-700">
                        Print NOT confirmed — {queuedCount + errorCount} item{(queuedCount + errorCount) !== 1 ? 's' : ''} queued but printer did not flush
                      </p>
                      {stage2Message && <p className="text-xs text-red-600 mt-1 break-words">{stage2Message}</p>}
                      <p className="text-[11px] text-red-500 mt-1">Check JARVISmart logs and printer status.</p>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                      <p className="text-sm font-medium text-amber-700">
                        {queuedCount} item{queuedCount !== 1 ? 's' : ''} queued ({totalLabels} label{totalLabels !== 1 ? 's' : ''})
                        {errorCount > 0 && <span className="text-red-600"> · {errorCount} failed</span>}
                      </p>
                      {stage2Message && <p className="text-xs text-amber-600 mt-1">{stage2Message}</p>}
                    </div>
                  )}
                  <button onClick={onClose} className="text-sm text-violet-600 underline">Close</button>
                </div>
              ) : (
                <>
                  {/* Print Now — primary */}
                  <button
                    onClick={() => handlePrintAll(true)}
                    disabled={processing || entries.length === 0 || !selectedPrinter || loading || !!printerLoadError}
                    className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {processing ? (
                      <><Loader2 size={16} className="animate-spin" /> Printing...</>
                    ) : (
                      <><Zap size={16} /> Print {totalLabels} Label{totalLabels !== 1 ? 's' : ''} Now</>
                    )}
                  </button>
                  {/* Queue Only — secondary */}
                  <button
                    onClick={() => handlePrintAll(false)}
                    disabled={processing || entries.length === 0 || !selectedPrinter || loading || !!printerLoadError}
                    className="w-full py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-gray-50"
                  >
                    <ListPlus size={16} /> Add to Queue Only
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Queue view */}
            <div className="flex-1 overflow-auto px-4 py-3">
              {queueLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Loading queue...
                </div>
              ) : queueItems.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400">
                  No labels in queue
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-xs text-gray-500 font-medium">{queuePending} pending label{queuePending !== 1 ? 's' : ''}</p>
                    <button onClick={loadQueue} className="text-xs text-violet-600 flex items-center gap-1">
                      <RefreshCw size={10} /> Refresh
                    </button>
                  </div>
                  {queueItems.map((qi, idx) => (
                    <div key={`${qi.barcode}-${idx}`} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{qi.description}</p>
                        <p className="text-xs text-gray-400">
                          {qi.barcode} · ${fmtMoney(qi.sellPrice)}
                          {qi.count > 1 && <span className="text-violet-600 font-medium"> x{qi.count}</span>}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveFromQueue([qi.barcode])}
                        className="text-gray-400 hover:text-red-500 shrink-0 ml-2"
                        title="Remove from queue"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer — Queue tab */}
            <div className="border-t border-gray-100 p-4 shrink-0 space-y-2">
              {queueMsg && (
                <p className={`text-xs font-medium text-center ${queueMsg.includes('failed') ? 'text-red-600' : 'text-green-600'}`}>
                  {queueMsg}
                </p>
              )}
              <button
                onClick={handlePrintQueue}
                disabled={printingQueue || queueItems.length === 0 || !selectedPrinter}
                className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {printingQueue ? (
                  <><Loader2 size={16} className="animate-spin" /> Sending to printer...</>
                ) : (
                  <><Zap size={16} /> Print Queue ({queuePending} label{queuePending !== 1 ? 's' : ''})</>
                )}
              </button>
              {queueItems.length > 0 && (
                <button
                  onClick={() => handleRemoveFromQueue(queueItems.map(q => q.barcode))}
                  disabled={printingQueue}
                  className="w-full py-2.5 border border-red-200 text-red-600 text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-red-50"
                >
                  <Trash2 size={14} /> Clear Entire Queue
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
