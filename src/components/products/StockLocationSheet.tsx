import { useState, useEffect, useMemo } from 'react'
import { MapPin, Loader2, Trash2, Plus, CheckCircle, ArrowRight } from 'lucide-react'
import type { StockItem, StockLocation, ItemLocation } from '../../lib/jarvis'
import { getLocations, getItemLocations } from '../../lib/jarvis'
import { assignItemLocation, removeItemLocation, moveItemLocation } from '../../lib/jarvisActions'
import { flattenLocations, buildLocationTree, formatItemLocation } from '../../lib/locationUtils'
import { LocationLevelColumn, resolveTargetLocation, hasAnyCascadeInput } from './LocationCascade'

interface StockLocationSheetProps {
  item: StockItem
  onClose: () => void
}

export default function StockLocationSheet({ item, onClose }: StockLocationSheetProps) {
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [itemLocations, setItemLocations] = useState<ItemLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Cascading location picker — matches BulkLocationSheet behaviour so bays
  // render in the same id-ascending (DB insertion) order and hidden branches
  // (active === false) are filtered out consistently.
  const [zoneId, setZoneId] = useState<number | ''>('')
  const [aisleId, setAisleId] = useState<number | ''>('')
  const [bayId, setBayId] = useState<number | ''>('')
  const [shelfId, setShelfId] = useState<number | ''>('')

  function pickZone(id: number | '')  { setZoneId(id);  setAisleId(''); setBayId(''); setShelfId('') }
  function pickAisle(id: number | '') { setAisleId(id); setBayId('');  setShelfId('') }
  function pickBay(id: number | '')   { setBayId(id);   setShelfId('') }
  function pickShelf(id: number | '') { setShelfId(id) }

  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(locations)
    return flattenLocations(tree)
  }, [locations])

  const zones = useMemo(
    () => flatLocs.filter(l => l.typeId === 4).sort((a, b) => a.id - b.id),
    [flatLocs]
  )
  const aisles = useMemo(() => {
    if (!zoneId) return []
    return flatLocs
      .filter(l => l.typeId === 1 && l.parentId === zoneId)
      .sort((a, b) => a.id - b.id)
  }, [flatLocs, zoneId])
  const bays = useMemo(() => {
    if (!aisleId) return []
    return flatLocs
      .filter(l => l.typeId === 2 && l.parentId === aisleId)
      .sort((a, b) => a.id - b.id)
  }, [flatLocs, aisleId])
  const shelves = useMemo(() => {
    if (!bayId) return []
    return flatLocs
      .filter(l => l.typeId === 3 && l.parentId === bayId)
      .sort((a, b) => a.id - b.id)
  }, [flatLocs, bayId])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [allLocs, itemLocs] = await Promise.all([
          getLocations(),
          getItemLocations(item.itemCode),
        ])
        setLocations(allLocs.filter(l => l.active !== false))
        setItemLocations(itemLocs)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [item.itemCode])

  function clearCascade() { pickZone('') }

  function resolveTarget(): number | null {
    return resolveTargetLocation([
      { id: zoneId,  typeId: 4 },
      { id: aisleId, typeId: 1 },
      { id: bayId,   typeId: 2 },
      { id: shelfId, typeId: 3 },
    ])
  }

  async function handleAssign() {
    const targetId = resolveTarget()
    if (!targetId) return
    if (itemLocations.some(l => l.locationId === targetId)) {
      setError('Already assigned to this location')
      return
    }
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await assignItemLocation(targetId, item.itemCode)
      if (res.success) {
        setSuccessMsg('Item assigned to location')
        const updated = await getItemLocations(item.itemCode)
        setItemLocations(updated)
        clearCascade()
      } else {
        setError(res.message ?? 'Failed to assign')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(loc: ItemLocation) {
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await removeItemLocation(loc.locationId, item.itemCode)
      if (res.success) {
        setSuccessMsg('Removed from location')
        setItemLocations(prev => prev.filter(l => l.locationId !== loc.locationId))
      } else {
        setError(res.message ?? 'Failed to remove')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleMove(fromLoc: ItemLocation) {
    const targetId = resolveTarget()
    if (!targetId || targetId === fromLoc.locationId) return
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await moveItemLocation(fromLoc.locationId, item.itemCode, targetId)
      if (res.success) {
        setSuccessMsg('Item moved')
        const updated = await getItemLocations(item.itemCode)
        setItemLocations(updated)
        clearCascade()
      } else {
        setError(res.message ?? 'Failed to move')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cascadeLevels = [
    { id: zoneId,  typeId: 4 },
    { id: aisleId, typeId: 1 },
    { id: bayId,   typeId: 2 },
    { id: shelfId, typeId: 3 },
  ]
  const hasCascade = hasAnyCascadeInput(cascadeLevels)
  const targetId = resolveTarget()

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-6 space-y-4 pb-safe max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Stock Location</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        <p className="text-sm text-gray-600">{item.description}</p>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading locations...
          </div>
        ) : (
          <>
            {/* Cascade target picker — shared by Assign and Move */}
            <div className="bg-blue-50 rounded-lg p-3 space-y-2">
              <p className="text-[10px] font-semibold text-blue-500 uppercase">Target Location</p>
              <div className="space-y-2.5">
                {/* Progressive disclosure: each child level only appears once
                    its parent is picked. Clearing a parent (tap the picked chip)
                    removes every descendant level from the DOM, matching a
                    tree-branch feel rather than a flat four-row grid. */}
                <LocationLevelColumn
                  label="Zone"
                  options={zones}
                  selectedId={zoneId}
                  onSelectId={pickZone}
                  busy={busy}
                />
                {zoneId !== '' && (
                  <LocationLevelColumn
                    label="Aisle"
                    options={aisles}
                    selectedId={aisleId}
                    onSelectId={pickAisle}
                    busy={busy}
                  />
                )}
                {aisleId !== '' && (
                  <LocationLevelColumn
                    label="Bay"
                    options={bays}
                    selectedId={bayId}
                    onSelectId={pickBay}
                    busy={busy}
                  />
                )}
                {bayId !== '' && (
                  <LocationLevelColumn
                    label="Row"
                    options={shelves}
                    selectedId={shelfId}
                    onSelectId={pickShelf}
                    busy={busy}
                  />
                )}
              </div>
              <button
                onClick={handleAssign}
                disabled={busy || !hasCascade}
                className="w-full mt-1 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Assign to Location
              </button>
            </div>

            {/* Current locations */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase">Current Location{itemLocations.length !== 1 ? 's' : ''}</p>
              {itemLocations.length === 0 ? (
                <p className="text-xs text-gray-400">Not assigned to any location</p>
              ) : (
                itemLocations.map(loc => {
                  const canMoveHere = targetId != null && targetId !== loc.locationId
                  return (
                    <div key={loc.locationId} className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <MapPin size={14} className="text-violet-500 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-gray-800 block truncate">
                              {formatItemLocation(loc)}
                            </span>
                            {loc.typeName && (
                              <span className="text-[10px] text-gray-400">{loc.typeName}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemove(loc)}
                          disabled={busy}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 shrink-0"
                          title="Remove from location"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <button
                        onClick={() => handleMove(loc)}
                        disabled={busy || !canMoveHere}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-violet-200 text-violet-700 text-xs font-semibold rounded-lg disabled:opacity-40 disabled:border-gray-200 disabled:text-gray-400"
                        title={canMoveHere ? 'Move stock to the target location above' : 'Pick a different target above first'}
                      >
                        <ArrowRight size={12} />
                        Move here → target
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {successMsg && (
          <p className="text-xs text-green-600 font-medium flex items-center gap-1">
            <CheckCircle size={12} /> {successMsg}
          </p>
        )}
        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
      </div>
    </div>
  )
}
