import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Loader2, CheckCircle, AlertTriangle, MapPin, ScanBarcode } from 'lucide-react'
import type { StockItem, StockLocation, ItemLocation } from '../../lib/jarvis'
import { getLocations, getItemLocations, searchItems } from '../../lib/jarvis'
import { bulkAssignLocation } from '../../lib/jarvisActions'
import { flattenLocations, buildLocationTree } from '../../lib/locationUtils'
import { LocationLevelColumn, resolveTargetLocation, hasAnyCascadeInput } from './LocationCascade'
import LocationManagerDialog, { type CreatedLocation } from './LocationManagerDialog'
import BarcodeScanner from '../BarcodeScanner'

// UPC-A ↔ EAN-13 interop: scanners return leading zeros that POS may strip.
// Generate all plausible key variants so the barcodeMap lookup succeeds.
function barcodeVariants(code: string): string[] {
  const set = new Set([code])
  if (code.startsWith('00')) set.add(code.slice(2))
  if (code.startsWith('0')) set.add(code.slice(1))
  set.add('0' + code)
  return [...set]
}
function normBarcode(bc: string): string { return bc.replace(/^0+/, '') }

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
      // Treat missing/undefined `active` as active — only hide explicit false.
      // JARVISmart sometimes returns rows without the field set.
      const filtered = all.filter(l => l.active !== false)
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
  const [scanFinding, setScanFinding] = useState(false)
  const [itemLocMap, setItemLocMap] = useState<Map<string, ItemLocation[]>>(new Map())
  const [locFetchingSet, setLocFetchingSet] = useState<Set<string>>(new Set())
  const [perItemResult, setPerItemResult] = useState<Map<string, 'new' | 'already' | 'failed'>>(new Map())
  const [assignedToId, setAssignedToId] = useState<number | null>(null)

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
    const qNorm = normBarcode(q)
    return items
      .filter(i => !addedCodes.has(i.itemCode))
      .filter(i =>
        i.description.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q) ||
        (i.barcode && (i.barcode.includes(q) || normBarcode(i.barcode) === qNorm)) ||
        (i.orderCode && i.orderCode.includes(q))
      )
      .slice(0, 10)
  }, [search, items, addedCodes])

  useEffect(() => {
    getLocations()
      .then(all => setLocations(all.filter(l => l.active !== false)))
      .catch(() => setError('Failed to load locations'))
      .finally(() => setLocLoading(false))
  }, [])

  const fetchLocForItem = useCallback(async (itemCode: string) => {
    setLocFetchingSet(prev => new Set(prev).add(itemCode))
    try {
      const locs = await getItemLocations(itemCode)
      setItemLocMap(prev => new Map(prev).set(itemCode, locs))
    } catch {
      setItemLocMap(prev => new Map(prev).set(itemCode, []))
    } finally {
      setLocFetchingSet(prev => { const s = new Set(prev); s.delete(itemCode); return s })
    }
  }, [])

  const handleScan = useCallback(async (code: string) => {
    setScannerOpen(false)
    // 1. Try the local cache with leading-zero variants (UPC-A ↔ EAN-13)
    let local: StockItem | undefined
    for (const v of barcodeVariants(code)) {
      local = barcodeMap.get(v)
      if (local) break
    }
    if (local) {
      if (!addedCodes.has(local.itemCode)) {
        setEntries(prev => [...prev, local!])
        fetchLocForItem(local.itemCode)
      }
      return
    }
    // 2. Server search — try the scanned code, then retry with zeros stripped
    //    in case the POS stores a shorter form.
    setScanFinding(true)
    try {
      let res = await searchItems(code, 10, true)
      const stripped = code.replace(/^0+/, '')
      if (res.items.length === 0 && stripped !== code) {
        res = await searchItems(stripped, 10, true)
      }
      // Match by normalized barcode (ignore leading-zero differences)
      const codeNorm = normBarcode(code)
      const found =
        res.items.find(i => i.barcode != null && normBarcode(i.barcode) === codeNorm) ??
        (res.items.length === 1 ? res.items[0] : null)
      if (found && !addedCodes.has(found.itemCode)) {
        setEntries(prev => [...prev, found])
        fetchLocForItem(found.itemCode)
      } else {
        setSearch(code)
      }
    } catch {
      setSearch(code)
    } finally {
      setScanFinding(false)
    }
  }, [barcodeMap, addedCodes, fetchLocForItem])

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
    setPerItemResult(new Map())
    // Snapshot current location data before assigning so we can detect "already here"
    const preMap = new Map(itemLocMap)
    try {
      const res = await bulkAssignLocation(targetId, entries.map(e => e.itemCode))
      if (res.success) {
        // Re-fetch all item locations to get actual post-assign state
        const fetched = await Promise.allSettled(
          entries.map(async e => {
            try {
              const locs = await getItemLocations(e.itemCode)
              return { itemCode: e.itemCode, locs }
            } catch {
              return { itemCode: e.itemCode, locs: [] as ItemLocation[] }
            }
          })
        )
        const postMap = new Map<string, ItemLocation[]>()
        for (const r of fetched) {
          if (r.status === 'fulfilled') postMap.set(r.value.itemCode, r.value.locs)
        }
        setItemLocMap(prev => {
          const next = new Map(prev)
          for (const [k, v] of postMap) next.set(k, v)
          return next
        })
        // Classify each item: 'new' = just assigned, 'already' = was there before, 'failed' = not at location
        const perItem = new Map<string, 'new' | 'already' | 'failed'>()
        for (const e of entries) {
          const postLocs = postMap.get(e.itemCode) ?? []
          const preLocs = preMap.get(e.itemCode) ?? []
          const isHereNow = postLocs.some(l => l.locationId === targetId)
          const wasHereBefore = preLocs.some(l => l.locationId === targetId)
          perItem.set(e.itemCode, isHereNow ? (wasHereBefore ? 'already' : 'new') : 'failed')
        }
        setPerItemResult(perItem)
        setAssignedToId(targetId)
        const newCount = [...perItem.values()].filter(v => v === 'new').length
        const alreadyCount = [...perItem.values()].filter(v => v === 'already').length
        const failedCount = [...perItem.values()].filter(v => v === 'failed').length
        const parts: string[] = []
        if (newCount > 0) parts.push(`${newCount} newly assigned`)
        if (alreadyCount > 0) parts.push(`${alreadyCount} already at this location`)
        if (failedCount > 0) parts.push(`${failedCount} failed`)
        setResult({ ok: newCount, failed: failedCount, message: parts.join(' · ') || 'No changes' })
      } else {
        // Surface server response detail so the user can diagnose on phone (no F12)
        const detail = res.message || (res.raw ? JSON.stringify(res.raw) : 'no detail')
        setResult({
          ok: 0,
          failed: entries.length,
          message: `Server refused: ${detail} (location #${targetId})`,
        })
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
              <div className="space-y-2.5">
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
                  label="Row"
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
          {scanFinding && (
            <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1.5 px-1">
              <Loader2 size={11} className="animate-spin" /> Looking up barcode on server...
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-auto">
              {searchResults.map(item => (
                <button
                  key={item.itemCode}
                  onClick={() => { setEntries(prev => [...prev, item]); fetchLocForItem(item.itemCode); setSearch('') }}
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
              {entries.map(entry => {
                const isFetchingLoc = locFetchingSet.has(entry.itemCode)
                const locResult = perItemResult.get(entry.itemCode)
                const locs = itemLocMap.get(entry.itemCode)
                let locBadge: React.ReactNode = null
                if (isFetchingLoc) {
                  locBadge = <Loader2 size={11} className="animate-spin text-gray-300 shrink-0" />
                } else if (locResult === 'new') {
                  const sc = locs?.find(l => l.locationId === assignedToId)?.shortCode
                  locBadge = <span className="shrink-0 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">✓ {sc ?? 'Assigned'}</span>
                } else if (locResult === 'already') {
                  const sc = locs?.find(l => l.locationId === assignedToId)?.shortCode
                  locBadge = <span className="shrink-0 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{sc ?? 'Already here'}</span>
                } else if (locResult === 'failed') {
                  locBadge = <span className="shrink-0 text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Failed</span>
                } else if (locs && locs.length > 0) {
                  locBadge = <span className="shrink-0 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{locs.map(l => l.shortCode).join(' · ')}</span>
                } else if (locs && locs.length === 0) {
                  locBadge = <span className="shrink-0 text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">No loc</span>
                }
                return (
                  <div key={entry.itemCode} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{entry.description}</p>
                      <p className="text-xs text-gray-400">{entry.barcode ?? entry.itemCode}</p>
                    </div>
                    {locBadge}
                    {!processing && !result && (
                      <button onClick={() => setEntries(prev => prev.filter(e => e.itemCode !== entry.itemCode))} className="text-gray-400 hover:text-red-500 shrink-0">
                        <X size={16} />
                      </button>
                    )}
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
              {result.failed > 0 && result.ok === 0 ? (
                <p className="text-sm font-medium text-red-600 flex items-center justify-center gap-1">
                  <AlertTriangle size={14} />
                  {result.failed} item{result.failed !== 1 ? 's' : ''} failed
                </p>
              ) : (
                <p className="text-sm font-medium text-green-600 flex items-center justify-center gap-1">
                  <CheckCircle size={14} />
                  {result.ok > 0 ? `${result.ok} newly assigned` : 'Done'}
                  {result.failed > 0 && <span className="text-red-500 ml-1">· {result.failed} failed</span>}
                </p>
              )}
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

