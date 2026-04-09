import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Loader2, CheckCircle, MapPin, ScanBarcode } from 'lucide-react'
import type { StockItem, StockLocation } from '../../lib/jarvis'
import { getLocations } from '../../lib/jarvis'
import { bulkAssignLocation } from '../../lib/jarvisActions'
import { flattenLocations, buildLocationTree } from '../../lib/locationUtils'
import { LocationLevelColumn, resolveTargetLocation, hasAnyCascadeInput } from './LocationCascade'
import LocationManagerDialog, { type CreatedLocation } from './LocationManagerDialog'
import BarcodeScanner from '../BarcodeScanner'

interface BulkLocationSheetProps {
  items: StockItem[]
  onClose: () => void
}

export default function BulkLocationSheet({ items, onClose }: BulkLocationSheetProps) {
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<StockItem[]>([])
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [locLoading, setLocLoading] = useState(true)

  // Cascading location fields
  const [zoneId, setZoneId] = useState<number | ''>('')
  const [aisleId, setAisleId] = useState<number | ''>('')
  const [bayId, setBayId] = useState<number | ''>('')
  const [shelfId, setShelfId] = useState<number | ''>('')

  // Create-location dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [createInitialType, setCreateInitialType] = useState<number>(4)
  const [createInitialParent, setCreateInitialParent] = useState<number | undefined>(undefined)

  // Cascade clearing — picking a level resets all descendants
  function pickZone(id: number | '') {
    setZoneId(id); setAisleId(''); setBayId(''); setShelfId('')
  }
  function pickAisle(id: number | '') {
    setAisleId(id); setBayId(''); setShelfId('')
  }
  function pickBay(id: number | '') {
    setBayId(id); setShelfId('')
  }
  function pickShelf(id: number | '') {
    setShelfId(id)
  }

  function openCreateDialog() {
    let nextType = 4
    let parent: number | undefined = undefined
    if (zoneId && !aisleId) { nextType = 1; parent = typeof zoneId === 'number' ? zoneId : undefined }
    else if (aisleId && !bayId) { nextType = 2; parent = typeof aisleId === 'number' ? aisleId : undefined }
    else if (bayId && !shelfId) { nextType = 3; parent = typeof bayId === 'number' ? bayId : undefined }
    setCreateInitialType(nextType)
    setCreateInitialParent(parent)
    setCreateOpen(true)
  }

  function handleLocationCreated(loc: CreatedLocation) {
    // Optimistic add to cascade dropdown options (guards against server cache lag)
    setLocations(prev => {
      if (prev.some(l => l.id === loc.id)) return prev
      return [...prev, { ...loc, active: true } as StockLocation]
    })
    // Pre-select in the cascade so the user doesn't have to manually pick it
    if (loc.typeId === 4) setZoneId(loc.id)
    else if (loc.typeId === 1) setAisleId(loc.id)
    else if (loc.typeId === 2) setBayId(loc.id)
    else if (loc.typeId === 3) setShelfId(loc.id)
  }

  async function handleManagerClose() {
    setCreateOpen(false)
    // Sync with server on close, merging with any optimistic adds
    try {
      const all = await getLocations()
      const filtered = all.filter(l => l.active)
      setLocations(prev => {
        const serverIds = new Set(filtered.map(l => l.id))
        const localOnly = prev.filter(l => !serverIds.has(l.id))
        return [...filtered, ...localOnly]
      })
    } catch {
      // Optimistic state remains valid
    }
  }

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

  // Flatten locations and derive cascading per-level lists
  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(locations)
    return flattenLocations(tree)
  }, [locations])

  const zones = useMemo(() => flatLocs.filter(l => l.typeId === 4), [flatLocs])
  const aisles = useMemo(() => {
    const all = flatLocs.filter(l => l.typeId === 1)
    return zoneId ? all.filter(l => l.parentId === zoneId) : all
  }, [flatLocs, zoneId])
  const bays = useMemo(() => {
    const all = flatLocs.filter(l => l.typeId === 2)
    return aisleId ? all.filter(l => l.parentId === aisleId) : all
  }, [flatLocs, aisleId])
  const shelves = useMemo(() => {
    const all = flatLocs.filter(l => l.typeId === 3)
    return bayId ? all.filter(l => l.parentId === bayId) : all
  }, [flatLocs, bayId])

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
    getLocations()
      .then(all => setLocations(all.filter(l => l.active)))
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

  async function handleAssignAll() {
    if (entries.length === 0) return
    const targetId = resolveTargetLocation([
      { id: zoneId, typeId: 4 },
      { id: aisleId, typeId: 1 },
      { id: bayId, typeId: 2 },
      { id: shelfId, typeId: 3 },
    ])
    if (!targetId) {
      setError('Select a location level')
      return
    }
    setProcessing(true)
    setError(null)
    setResult(null)
    try {
      const res = await bulkAssignLocation(targetId, entries.map(e => e.itemCode))
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

  const hasAnyLevel = hasAnyCascadeInput([
    { id: zoneId, typeId: 4 },
    { id: aisleId, typeId: 1 },
    { id: bayId, typeId: 2 },
    { id: shelfId, typeId: 3 },
  ])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Bulk Location Assignment</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Cascading location selection */}
        <div className="px-4 pt-3 pb-3 border-b border-gray-100 shrink-0 space-y-2.5">
          {locLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading locations...
            </div>
          ) : (
            <div className="bg-blue-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-blue-500 uppercase">Target Location</p>
                <button
                  onClick={openCreateDialog}
                  disabled={processing}
                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  Manage
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <LocationLevelColumn
                  label="Zone"
                  options={zones}
                  selectedId={zoneId}
                  onSelectId={pickZone}
                  busy={processing}
                />
                <LocationLevelColumn
                  label="Aisle"
                  options={aisles}
                  selectedId={aisleId}
                  onSelectId={pickAisle}
                  busy={processing}
                />
                <LocationLevelColumn
                  label="Bay"
                  options={bays}
                  selectedId={bayId}
                  onSelectId={pickBay}
                  busy={processing}
                />
                <LocationLevelColumn
                  label="Shelf"
                  options={shelves}
                  selectedId={shelfId}
                  onSelectId={pickShelf}
                  busy={processing}
                />
              </div>
            </div>
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
              disabled={processing || entries.length === 0 || !hasAnyLevel}
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

      <LocationManagerDialog
        open={createOpen}
        onClose={handleManagerClose}
        onCreated={handleLocationCreated}
        initialTypeId={createInitialType}
        initialParentId={createInitialParent}
      />
    </div>
  )
}

