import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Loader2, CheckCircle, MapPin, Plus, ScanBarcode } from 'lucide-react'
import type { StockItem, StockLocation, LocationType } from '../../lib/jarvis'
import { getLocations, getLocationTypes } from '../../lib/jarvis'
import { bulkAssignLocation, createLocation } from '../../lib/jarvisActions'
import { flattenLocations, buildLocationTree, getTypeLabel } from '../../lib/locationUtils'
import BarcodeScanner from '../BarcodeScanner'

interface BulkLocationSheetProps {
  items: StockItem[]
  onClose: () => void
}

export default function BulkLocationSheet({ items, onClose }: BulkLocationSheetProps) {
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<StockItem[]>([])
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([])
  const [locLoading, setLocLoading] = useState(true)
  const [selectedLocId, setSelectedLocId] = useState<number | ''>('')

  // Create new location fields
  const [newLocName, setNewLocName] = useState('')
  const [newLocCode, setNewLocCode] = useState('')
  const [newLocTypeId, setNewLocTypeId] = useState<number>(2)
  const [newLocParentId, setNewLocParentId] = useState<number | ''>('')
  const [createBusy, setCreateBusy] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: number; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [scannerOpen, setScannerOpen] = useState(false)

  const addedCodes = useMemo(() => new Set(entries.map(e => e.itemCode)), [entries])

  // Build barcode → item lookup for scanner
  const barcodeMap = useMemo(() => {
    const map = new Map<string, StockItem>()
    for (const i of items) if (i.barcode) map.set(i.barcode, i)
    return map
  }, [items])

  // Flatten locations for dropdown
  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(locations)
    return flattenLocations(tree)
  }, [locations])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return items
      .filter(i => !addedCodes.has(i.itemCode))
      .filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
      .slice(0, 10)
  }, [search, items, addedCodes])

  useEffect(() => {
    Promise.all([getLocations(), getLocationTypes()])
      .then(([all, types]) => {
        setLocations(all.filter(l => l.active))
        setLocationTypes(types)
      })
      .catch(() => setError('Failed to load locations'))
      .finally(() => setLocLoading(false))
  }, [])

  const handleScan = useCallback((code: string) => {
    setScannerOpen(false)
    const item = barcodeMap.get(code)
    if (item && !addedCodes.has(item.itemCode)) {
      setEntries(prev => [...prev, item])
    } else if (!item) {
      setSearch(code)
    }
  }, [barcodeMap, addedCodes])

  async function handleCreateLocation() {
    if (!newLocName.trim() || !newLocCode.trim()) return
    setCreateBusy(true)
    setError(null)
    try {
      const res = await createLocation(
        newLocName.trim(),
        newLocCode.trim(),
        newLocTypeId,
        newLocParentId ? Number(newLocParentId) : undefined,
      )
      if (res.success && res.id) {
        const updated = await getLocations()
        setLocations(updated.filter(l => l.active))
        setSelectedLocId(res.id)
        setNewLocName(''); setNewLocCode(''); setNewLocParentId('')
      } else {
        setError(res.message ?? 'Failed to create location')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleAssignAll() {
    if (!selectedLocId || entries.length === 0) return
    setProcessing(true)
    setError(null)
    setResult(null)
    try {
      const res = await bulkAssignLocation(
        Number(selectedLocId),
        entries.map(e => e.itemCode)
      )
      if (res.success) {
        setResult({
          ok: res.assigned ?? entries.length,
          failed: 0,
          message: res.message ?? `${res.assigned ?? entries.length} item(s) assigned`,
        })
      } else {
        setResult({ ok: 0, failed: entries.length, message: res.message ?? 'Failed to assign' })
      }
    } catch (err) {
      setResult({ ok: 0, failed: entries.length, message: (err as Error).message })
    } finally {
      setProcessing(false)
    }
  }

  const selectedLoc = flatLocs.find(l => l.id === selectedLocId)

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk Location Assignment</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Location selection + creation */}
        <div className="px-4 pt-3 pb-3 border-b border-gray-100 shrink-0 space-y-2.5">
          {locLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading locations...
            </div>
          ) : (
            <>
              {/* Select existing */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 uppercase">Target Location</label>
                <select
                  value={selectedLocId}
                  onChange={e => setSelectedLocId(e.target.value ? Number(e.target.value) : '')}
                  disabled={processing}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="">Select location...</option>
                  {flatLocs.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.path} ({getTypeLabel(l.typeId, l.typeName)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedLoc && (
                <p className="text-xs text-blue-600 font-medium px-1">
                  <MapPin size={10} className="inline" /> {selectedLoc.path}
                </p>
              )}

              {/* Or create new — always visible */}
              <div className="bg-blue-50 rounded-lg p-3 space-y-2">
                <p className="text-[10px] font-semibold text-blue-500 uppercase flex items-center gap-1"><Plus size={10} /> Or Create New Location</p>
                <div className="flex gap-1.5">
                  <select
                    value={newLocTypeId}
                    onChange={e => setNewLocTypeId(Number(e.target.value))}
                    disabled={processing}
                    className="w-20 border border-blue-200 rounded-lg px-1.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                  >
                    {locationTypes.length > 0 ? locationTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    )) : (
                      <>
                        <option value={4}>Zone</option>
                        <option value={1}>Aisle</option>
                        <option value={2}>Bay</option>
                        <option value={3}>Row</option>
                      </>
                    )}
                  </select>
                  <input
                    type="text"
                    value={newLocName}
                    onChange={e => setNewLocName(e.target.value)}
                    placeholder="Name"
                    disabled={processing}
                    className="flex-1 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                  />
                  <input
                    type="text"
                    value={newLocCode}
                    onChange={e => setNewLocCode(e.target.value)}
                    placeholder="Short code"
                    disabled={processing}
                    className="w-20 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div className="flex gap-1.5">
                  <select
                    value={newLocParentId}
                    onChange={e => setNewLocParentId(e.target.value ? Number(e.target.value) : '')}
                    disabled={processing}
                    className="flex-1 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-300"
                  >
                    <option value="">No parent (top level)</option>
                    {flatLocs.map(l => (
                      <option key={l.id} value={l.id}>{l.path}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleCreateLocation}
                    disabled={createBusy || !newLocName.trim() || !newLocCode.trim() || processing}
                    className="px-2.5 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    {createBusy ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Search + Scan */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search or scan products..."
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
              <ScanBarcode size={18} />
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-auto">
              {searchResults.map(item => (
                <button
                  key={item.itemCode}
                  onClick={() => { setEntries(prev => [...prev, item]); setSearch('') }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{item.description}</p>
                    <p className="text-xs text-gray-400">{item.barcode ?? item.itemCode}</p>
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
              Search or scan barcodes to add products
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400 px-1">{entries.length} item{entries.length !== 1 ? 's' : ''} selected</p>
              {entries.map(entry => (
                <div key={entry.itemCode} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{entry.description}</p>
                    <p className="text-xs text-gray-400">{entry.barcode ?? entry.itemCode}</p>
                  </div>
                  {!processing && !result && (
                    <button onClick={() => setEntries(prev => prev.filter(e => e.itemCode !== entry.itemCode))} className="text-gray-400 hover:text-red-500 shrink-0 ml-2">
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 shrink-0">
          {result ? (
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-green-600 flex items-center justify-center gap-1">
                <CheckCircle size={14} />
                {result.ok} item{result.ok !== 1 ? 's' : ''} assigned
                {result.failed > 0 && <span className="text-red-600"> · {result.failed} failed</span>}
              </p>
              <p className="text-xs text-gray-400">{result.message}</p>
              <button onClick={onClose} className="text-sm text-violet-600 underline">Close</button>
            </div>
          ) : (
            <button
              onClick={handleAssignAll}
              disabled={processing || entries.length === 0 || !selectedLocId}
              className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? (
                <><Loader2 size={16} className="animate-spin" /> Assigning...</>
              ) : (
                <><MapPin size={16} /> Assign {entries.length} Item{entries.length !== 1 ? 's' : ''} to Location</>
              )}
            </button>
          )}

          {error && <p className="text-xs text-red-600 font-medium text-center mt-2">{error}</p>}
        </div>
      </div>

      <BarcodeScanner open={scannerOpen} onScan={handleScan} onClose={() => setScannerOpen(false)} />
    </div>
  )
}
