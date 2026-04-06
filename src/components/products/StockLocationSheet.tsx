import { useState, useEffect, useMemo } from 'react'
import { MapPin, Loader2, ArrowRight, Trash2, Plus, CheckCircle } from 'lucide-react'
import type { StockItem, StockLocation, ItemLocation } from '../../lib/jarvis'
import { getLocations, getItemLocations } from '../../lib/jarvis'
import { assignItemLocation, removeItemLocation, moveItemLocation } from '../../lib/jarvisActions'
import { flattenLocations, buildLocationTree, formatItemLocation, getTypeLabel } from '../../lib/locationUtils'

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
  const [selectedLocId, setSelectedLocId] = useState<number | ''>('')
  const [moveTargetId, setMoveTargetId] = useState<number | ''>('')

  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(locations)
    return flattenLocations(tree)
  }, [locations])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [allLocs, itemLocs] = await Promise.all([
          getLocations(),
          getItemLocations(item.itemCode),
        ])
        setLocations(allLocs.filter(l => l.active))
        setItemLocations(itemLocs)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [item.itemCode])

  async function handleAssign() {
    if (!selectedLocId) return
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await assignItemLocation(Number(selectedLocId), item.itemCode)
      if (res.success) {
        setSuccessMsg('Item assigned to location')
        const updated = await getItemLocations(item.itemCode)
        setItemLocations(updated)
        setSelectedLocId('')
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
    if (!moveTargetId) return
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await moveItemLocation(fromLoc.locationId, item.itemCode, Number(moveTargetId))
      if (res.success) {
        setSuccessMsg('Item moved')
        const updated = await getItemLocations(item.itemCode)
        setItemLocations(updated)
        setMoveTargetId('')
      } else {
        setError(res.message ?? 'Failed to move')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const availableForAssign = useMemo(() => {
    const assigned = new Set(itemLocations.map(il => il.locationId))
    return flatLocs.filter(l => !assigned.has(l.id))
  }, [flatLocs, itemLocations])

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
            {/* Current locations */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase">Current Location{itemLocations.length !== 1 ? 's' : ''}</p>
              {itemLocations.length === 0 ? (
                <p className="text-xs text-gray-400">Not assigned to any location</p>
              ) : (
                itemLocations.map(loc => (
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
                    {/* Move controls */}
                    <div className="flex items-center gap-2">
                      <ArrowRight size={12} className="text-gray-400 shrink-0" />
                      <select
                        value={moveTargetId}
                        onChange={e => setMoveTargetId(e.target.value ? Number(e.target.value) : '')}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-violet-300"
                      >
                        <option value="">Move to...</option>
                        {flatLocs.filter(l => l.id !== loc.locationId).map(l => (
                          <option key={l.id} value={l.id}>{l.path} ({getTypeLabel(l.typeId, l.typeName)})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMove(loc)}
                        disabled={busy || !moveTargetId}
                        className="px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                      >
                        Move
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Assign to location */}
            {availableForAssign.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">Assign to Location</p>
                <div className="flex gap-2">
                  <select
                    value={selectedLocId}
                    onChange={e => setSelectedLocId(e.target.value ? Number(e.target.value) : '')}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-violet-300"
                  >
                    <option value="">Select location...</option>
                    {availableForAssign.map(l => (
                      <option key={l.id} value={l.id}>{l.path} ({getTypeLabel(l.typeId, l.typeName)})</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAssign}
                    disabled={busy || !selectedLocId}
                    className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-1"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Assign
                  </button>
                </div>
              </div>
            )}
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
