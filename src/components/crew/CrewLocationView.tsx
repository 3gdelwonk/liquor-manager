import { useState, useEffect, useMemo } from 'react'
import { MapPin, Loader2, RefreshCw } from 'lucide-react'
import { getLocations } from '../../lib/jarvis'
import { buildLocationTree, flattenLocations, TYPE_DISPLAY_LABELS } from '../../lib/locationUtils'
import LocationManagerDialog, { type CreatedLocation } from '../products/LocationManagerDialog'
import type { StockLocation } from '../../lib/jarvis'

export default function CrewLocationView() {
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  const flatLocs = useMemo(() => flattenLocations(buildLocationTree(locations)), [locations])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const all = await getLocations()
      setLocations(all.filter(l => l.active !== false))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleCreated(loc: CreatedLocation) {
    // Optimistically add to local list so the tree updates without waiting for GET
    setLocations(prev =>
      prev.some(l => l.id === loc.id)
        ? prev
        : [...prev, { ...loc, active: true } as StockLocation]
    )
  }

  function handleManagerClose() {
    setManagerOpen(false)
    load() // refresh after any changes
  }

  // Build a grouped summary: zones → aisles → bays → rows
  const zones = flatLocs.filter(l => l.typeId === 4)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase">
          {loading ? 'Loading…' : `${flatLocs.length} location${flatLocs.length !== 1 ? 's' : ''}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg"
          >
            <MapPin size={13} /> Manage Locations
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading locations…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && flatLocs.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <MapPin size={32} className="text-gray-300" />
            <p className="text-sm text-gray-400">No locations set up yet.</p>
            <button
              onClick={() => setManagerOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg"
            >
              Add First Location
            </button>
          </div>
        )}

        {!loading && zones.map(zone => {
          const aisles = flatLocs.filter(l => l.typeId === 1 && l.parentId === zone.id)
          return (
            <div key={zone.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Zone header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white">
                <MapPin size={12} />
                <p className="text-xs font-bold uppercase tracking-wide">
                  {TYPE_DISPLAY_LABELS[4]}: {zone.name}
                  <span className="ml-1.5 opacity-70 font-normal">({zone.shortCode})</span>
                </p>
              </div>

              {aisles.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-gray-400 italic">No aisles</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {aisles.map(aisle => {
                    const bays = flatLocs.filter(l => l.typeId === 2 && l.parentId === aisle.id)
                    return (
                      <div key={aisle.id} className="px-3 py-2 space-y-1.5">
                        <p className="text-[11px] font-semibold text-gray-700">
                          {TYPE_DISPLAY_LABELS[1]}: {aisle.name}
                          <span className="ml-1 text-gray-400 font-normal">({aisle.shortCode})</span>
                        </p>
                        {bays.length > 0 && (
                          <div className="pl-3 space-y-1">
                            {bays.map(bay => {
                              const rows = flatLocs.filter(l => l.typeId === 3 && l.parentId === bay.id)
                              return (
                                <div key={bay.id}>
                                  <p className="text-[10px] text-gray-600">
                                    {TYPE_DISPLAY_LABELS[2]}: {bay.name}
                                    <span className="ml-1 text-gray-400">({bay.shortCode})</span>
                                    {rows.length > 0 && (
                                      <span className="ml-2 text-gray-400">
                                        → {rows.map(r => r.shortCode || r.name).join(', ')}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Orphaned locations (not under any zone) */}
        {!loading && (() => {
          const zoneIds = new Set(zones.map(z => z.id))
          const aisleIds = new Set(flatLocs.filter(l => l.typeId === 1).map(l => l.id))
          const bayIds = new Set(flatLocs.filter(l => l.typeId === 2).map(l => l.id))
          const orphans = flatLocs.filter(l => {
            if (l.typeId === 4) return false // zone itself, shown above
            if (l.typeId === 1) return l.parentId == null || !zoneIds.has(l.parentId)
            if (l.typeId === 2) return l.parentId == null || !aisleIds.has(l.parentId)
            if (l.typeId === 3) return l.parentId == null || !bayIds.has(l.parentId)
            return false
          })
          if (orphans.length === 0) return null
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-amber-100">
                <p className="text-[11px] font-bold text-amber-700 uppercase">Unattached Locations</p>
              </div>
              <div className="px-3 py-2 space-y-1">
                {orphans.map(l => (
                  <p key={l.id} className="text-[11px] text-gray-700">
                    {TYPE_DISPLAY_LABELS[l.typeId]}: {l.name} ({l.shortCode})
                  </p>
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      <LocationManagerDialog
        open={managerOpen}
        onClose={handleManagerClose}
        onCreated={handleCreated}
      />
    </div>
  )
}
