import { useRef, useState } from 'react'
import { Upload, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { parseItemMaintenance, parseStockReport, parseSalesReport } from '../lib/importer'
import type { MaintenanceResult, StockResult, SalesResult } from '../lib/importer'

function DropZone({ label, accept, onFile }: { label: string; accept: string; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      onClick={() => ref.current?.click()}
      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-400 hover:bg-violet-50/50'}`}
    >
      <Upload size={20} className="mx-auto mb-2 text-gray-400" />
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className="text-xs text-gray-400 mt-1">Drop CSV or XLSX here, or tap to browse</p>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </div>
  )
}

type Status = 'idle' | 'loading' | 'success' | 'error'

interface SectionState<T> {
  status: Status
  result: T | null
  error: string | null
  expanded: boolean
}

function useSection<T>() {
  const [state, setState] = useState<SectionState<T>>({ status: 'idle', result: null, error: null, expanded: true })

  async function run(fn: () => Promise<T>) {
    setState(s => ({ ...s, status: 'loading', error: null }))
    try {
      const result = await fn()
      setState({ status: 'success', result, error: null, expanded: true })
    } catch (e) {
      setState(s => ({ ...s, status: 'error', error: e instanceof Error ? e.message : String(e) }))
    }
  }

  return { state, run, toggle: () => setState(s => ({ ...s, expanded: !s.expanded })) }
}

function StatusCard({ status, error, children }: { status: Status; error: string | null; children?: React.ReactNode }) {
  if (status === 'loading') return <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-500 animate-pulse">Importing…</div>
  if (status === 'error') return <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"><AlertCircle size={14} className="inline mr-1" />{error}</div>
  if (status === 'success') return <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">{children}</div>
  return null
}

function AnomalyList({ anomalies }: { anomalies: string[] }) {
  const [show, setShow] = useState(false)
  if (!anomalies.length) return null
  return (
    <div className="mt-2">
      <button onClick={() => setShow(s => !s)} className="flex items-center gap-1 text-xs text-amber-700 font-medium">
        <AlertCircle size={12} />
        {anomalies.length} notice{anomalies.length !== 1 ? 's' : ''}
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {show && (
        <ul className="mt-1 space-y-1">
          {anomalies.map((a, i) => <li key={i} className="text-xs text-amber-600">• {a}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function ImportView() {
  const maint = useSection<MaintenanceResult>()
  const stock = useSection<StockResult>()
  const sales = useSection<SalesResult>()

  const importLog = useLiveQuery(() => db.importLog.orderBy('importedAt').reverse().limit(20).toArray(), [])

  const ACCEPT = '.csv,.xlsx,.xls'

  return (
    <div className="p-4 space-y-5 pb-8">

      {/* Item Maintenance */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Smart Retail — Item Maintenance</h2>
          {maint.state.status !== 'idle' && (
            <button onClick={maint.toggle} className="text-gray-400">
              {maint.state.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
        <DropZone
          label="Item Maintenance Report (CSV / XLSX)"
          accept={ACCEPT}
          onFile={(f) => maint.run(() => parseItemMaintenance(f))}
        />
        {maint.state.expanded && (
          <StatusCard status={maint.state.status} error={maint.state.error}>
            {maint.state.result && (
              <>
                <div className="flex items-center gap-1 font-semibold mb-1"><CheckCircle size={14} />Import complete</div>
                <div className="space-y-0.5 text-xs">
                  <div>Updated: <strong>{maint.state.result.updated}</strong></div>
                  <div>New products: <strong>{maint.state.result.newProducts}</strong></div>
                  <div>Skipped: <strong>{maint.state.result.skipped}</strong></div>
                </div>
                <AnomalyList anomalies={maint.state.result.anomalies} />
                {maint.state.result.detectedColumns.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer">Column mapping</summary>
                    <ul className="mt-1 space-y-0.5">
                      {maint.state.result.detectedColumns.map((c, i) => (
                        <li key={i} className={`text-xs font-mono ${c.startsWith('✓') ? 'text-green-700' : 'text-red-500'}`}>{c}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </StatusCard>
        )}
      </div>

      {/* Stock Report */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Smart Retail — Stock Report</h2>
          {stock.state.status !== 'idle' && (
            <button onClick={stock.toggle} className="text-gray-400">
              {stock.state.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
        <DropZone
          label="Item Stock Report (CSV / XLSX)"
          accept={ACCEPT}
          onFile={(f) => stock.run(() => parseStockReport(f))}
        />
        {stock.state.expanded && (
          <StatusCard status={stock.state.status} error={stock.state.error}>
            {stock.state.result && (
              <>
                <div className="flex items-center gap-1 font-semibold mb-1"><CheckCircle size={14} />Stock imported</div>
                <div className="space-y-0.5 text-xs">
                  <div>Snapshots saved: <strong>{stock.state.result.snapshots}</strong></div>
                  <div>Matched: <strong>{stock.state.result.matched}</strong></div>
                  <div>Unmatched: <strong>{stock.state.result.unmatched}</strong></div>
                </div>
              </>
            )}
          </StatusCard>
        )}
      </div>

      {/* Sales Data */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">JARVISmart Sales Data</h2>
          {sales.state.status !== 'idle' && (
            <button onClick={sales.toggle} className="text-gray-400">
              {sales.state.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
        <DropZone
          label="Sales Report (CSV / XLSX)"
          accept={ACCEPT}
          onFile={(f) => sales.run(() => parseSalesReport(f))}
        />
        {sales.state.expanded && (
          <StatusCard status={sales.state.status} error={sales.state.error}>
            {sales.state.result && (
              <>
                <div className="flex items-center gap-1 font-semibold mb-1"><CheckCircle size={14} />Sales imported</div>
                <div className="space-y-0.5 text-xs">
                  <div>New records: <strong>{sales.state.result.newRecords}</strong></div>
                  <div>Updated: <strong>{sales.state.result.duplicateUpdated}</strong></div>
                  <div>Matched: <strong>{sales.state.result.matched}</strong></div>
                  <div>Unmatched: <strong>{sales.state.result.unmatched}</strong></div>
                  {sales.state.result.dateRange && (
                    <div>Range: <strong>{sales.state.result.dateRange.from}</strong> → <strong>{sales.state.result.dateRange.to}</strong></div>
                  )}
                </div>
                <AnomalyList anomalies={sales.state.result.anomalies} />
              </>
            )}
          </StatusCard>
        )}
      </div>

      {/* Audit Log */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Import Audit Log</h2>
        {!importLog?.length ? (
          <p className="text-xs text-gray-400 text-center py-4">No imports yet</p>
        ) : (
          <div className="space-y-2">
            {importLog.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  entry.type === 'item_maintenance' ? 'bg-violet-100 text-violet-700' :
                  entry.type === 'stock_report' ? 'bg-blue-100 text-blue-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {entry.type === 'item_maintenance' ? 'Maint' : entry.type === 'stock_report' ? 'Stock' : 'Sales'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-700 truncate">{entry.fileName}</p>
                  <p className="text-xs text-gray-400">{entry.recordCount} records • {entry.anomalyCount} notices</p>
                </div>
                <p className="text-xs text-gray-400 shrink-0">{new Date(entry.importedAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
