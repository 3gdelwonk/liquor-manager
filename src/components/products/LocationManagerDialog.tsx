import { useState, useMemo, useEffect, useCallback } from 'react'
import { Loader2, Plus, X, Pencil, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react'
import type { StockLocation } from '../../lib/jarvis'
import { getLocations } from '../../lib/jarvis'
import { createLocation, updateLocation } from '../../lib/jarvisActions'
import { buildLocationTree, flattenLocations, TYPE_DISPLAY_LABELS } from '../../lib/locationUtils'

// Parent type for each level. Zone has no parent.
const PARENT_TYPE: Record<number, number | null> = {
  4: null, // Zone → (root)
  1: 4,    // Aisle → Zone
  2: 1,    // Bay → Aisle
  3: 2,    // Shelf → Bay
}

export interface CreatedLocation {
  id: number
  typeId: number
  name: string
  shortCode: string
  parentId: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called after a successful create so parent can optimistically add + pre-select */
  onCreated: (loc: CreatedLocation) => void
  /** Called after a successful edit so parent can refresh if needed */
  onUpdated?: () => void
  initialTypeId?: number
  initialParentId?: number
}

interface DebugEntry {
  method: string
  path: string
  body: unknown
  response: unknown
  ok: boolean
  ts: number
}

export default function LocationManagerDialog({
  open,
  onClose,
  onCreated,
  onUpdated,
  initialTypeId = 4,
  initialParentId,
}: Props) {
  // Locations visible in the tree (dialog-local, with optimistic adds)
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // Form state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [typeId, setTypeId] = useState<number>(initialTypeId)
  const [parentId, setParentId] = useState<number | ''>(initialParentId ?? '')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  // UI feedback
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // On-screen debug log (replacement for console/devtools on mobile)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([])

  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(locations)
    return flattenLocations(tree)
  }, [locations])

  const parentTypeId = PARENT_TYPE[typeId]
  const parentOptions = useMemo(() => {
    if (parentTypeId == null) return []
    return flatLocs.filter(l => l.typeId === parentTypeId)
  }, [flatLocs, parentTypeId])

  const loadLocations = useCallback(async () => {
    setLoadingList(true)
    try {
      const all = await getLocations()
      const filtered = all.filter(l => l.active)
      // Merge: preserve any locally-added entries that the server GET didn't return yet
      // (guards against server-side caching of GET /api/pos/locations)
      setLocations(prev => {
        const serverIds = new Set(filtered.map(l => l.id))
        const localOnly = prev.filter(l => !serverIds.has(l.id))
        return [...filtered, ...localOnly]
      })
    } catch (err) {
      setError(`Failed to load locations: ${(err as Error).message}`)
      setDebugOpen(true)
    } finally {
      setLoadingList(false)
    }
  }, [])

  // Reset and load when opened
  useEffect(() => {
    if (!open) return
    setTypeId(initialTypeId)
    setParentId(initialParentId ?? '')
    setName('')
    setCode('')
    setError(null)
    setSuccess(null)
    setEditingId(null)
    setBusy(false)
    setLocations([])
    loadLocations()
  }, [open, initialTypeId, initialParentId, loadLocations])

  // If user changes type, reset parent if it becomes invalid
  useEffect(() => {
    if (parentTypeId == null) { setParentId(''); return }
    if (parentId !== '' && !parentOptions.some(o => o.id === parentId)) {
      setParentId('')
    }
  }, [typeId, parentTypeId, parentOptions, parentId])

  function addDebug(entry: DebugEntry) {
    setDebugLog(prev => [entry, ...prev].slice(0, 10))
  }

  function startEdit(loc: StockLocation) {
    setEditingId(loc.id)
    setTypeId(loc.typeId)
    setParentId(loc.parentId ?? '')
    setName(loc.name)
    setCode(loc.shortCode)
    setError(null)
    setSuccess(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setName('')
    setCode('')
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    setSuccess(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (!code.trim()) { setError('Code is required'); return }
    if (editingId == null && parentTypeId != null && parentId === '') {
      setError(`Select a ${TYPE_DISPLAY_LABELS[parentTypeId]} as parent`)
      return
    }

    setBusy(true)
    try {
      if (editingId != null) {
        // ── EDIT mode ───────────────────────────────────────────────────
        const payload = { name: name.trim(), shortCode: code.trim() }
        const res = await updateLocation(editingId, payload)
        addDebug({
          method: 'PUT',
          path: `/api/pos/locations/${editingId}`,
          body: payload,
          response: res.raw ?? res,
          ok: res.success,
          ts: Date.now(),
        })
        if (res.success) {
          setSuccess(`Updated "${name.trim()}"`)
          // Optimistic: patch local state
          setLocations(prev => prev.map(l =>
            l.id === editingId
              ? { ...l, name: name.trim(), shortCode: code.trim() }
              : l
          ))
          cancelEdit()
          onUpdated?.()
          await loadLocations()
        } else {
          setError(res.message || `Unexpected response: ${JSON.stringify(res.raw ?? res) || '(empty)'}`)
          setDebugOpen(true)
        }
      } else {
        // ── CREATE mode ─────────────────────────────────────────────────
        const payload: Record<string, unknown> = {
          name: name.trim(),
          shortCode: code.trim(),
          typeId,
        }
        if (parentTypeId != null) payload.parentId = parentId
        const res = await createLocation(
          name.trim(),
          code.trim(),
          typeId,
          parentTypeId != null ? (parentId as number) : undefined,
        )
        addDebug({
          method: 'POST',
          path: '/api/pos/locations',
          body: payload,
          response: res.raw ?? res,
          ok: res.success,
          ts: Date.now(),
        })
        if (res.success && res.id) {
          const created: CreatedLocation = {
            id: res.id,
            typeId,
            name: name.trim(),
            shortCode: code.trim(),
            parentId: parentTypeId != null ? (parentId as number) : null,
          }
          setSuccess(`Created ${TYPE_DISPLAY_LABELS[typeId]} "${created.name}" (#${created.id})`)
          // Optimistic add to dialog tree
          setLocations(prev =>
            prev.some(l => l.id === created.id)
              ? prev
              : [...prev, { ...created, active: true } as StockLocation]
          )
          // Notify parent (for optimistic add + cascade pre-select)
          onCreated(created)
          // Clear name+code for rapid multi-create, keep type+parent
          setName('')
          setCode('')
          // Sync with server (merges, doesn't drop our optimistic entry)
          await loadLocations()
        } else if (res.message) {
          setError(res.message)
          setDebugOpen(true)
        } else {
          setError(`Unexpected response — open debug log for details`)
          setDebugOpen(true)
        }
      }
    } catch (err) {
      setError((err as Error).message)
      setDebugOpen(true)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const formLabel = editingId != null
    ? `Edit ${TYPE_DISPLAY_LABELS[typeId]}`
    : `New ${TYPE_DISPLAY_LABELS[typeId]}`

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[92vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Plus size={16} className="text-blue-600" />
            Manage Locations
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {/* ── Form ──────────────────────────────────────────────────── */}
          <div className="p-4 space-y-3 border-b border-gray-100 bg-blue-50/30">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-blue-600 uppercase">{formLabel}</p>
              {editingId != null && (
                <button
                  onClick={cancelEdit}
                  disabled={busy}
                  className="text-[10px] font-semibold text-gray-500 hover:text-gray-700"
                >
                  ← New instead
                </button>
              )}
            </div>

            {/* Type buttons (disabled in edit mode — can't safely change typeId) */}
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Type</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[4, 1, 2, 3].map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeId(t)}
                    disabled={busy || editingId != null}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                      typeId === t
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    {TYPE_DISPLAY_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Parent selector (only for non-Zone, only in create mode) */}
            {parentTypeId != null && editingId == null && (
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">
                  Parent {TYPE_DISPLAY_LABELS[parentTypeId]}
                </label>
                <select
                  value={parentId === '' ? '' : String(parentId)}
                  onChange={e => setParentId(e.target.value ? Number(e.target.value) : '')}
                  disabled={busy}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
                >
                  <option value="">— Select {TYPE_DISPLAY_LABELS[parentTypeId]} —</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.path}</option>
                  ))}
                </select>
                {parentOptions.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    No {TYPE_DISPLAY_LABELS[parentTypeId]} exists yet — create one first.
                  </p>
                )}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`e.g. ${typeId === 4 ? 'Wine Zone' : typeId === 1 ? 'Aisle 1' : typeId === 2 ? 'Bay A' : 'Row 1'}`}
                disabled={busy}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
              />
            </div>

            {/* Short code */}
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Short Code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder={`e.g. ${typeId === 4 ? 'WZ' : typeId === 1 ? 'A1' : typeId === 2 ? 'BA' : 'S1'}`}
                disabled={busy}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {busy
                ? <><Loader2 size={14} className="animate-spin" /> Saving...</>
                : editingId != null
                  ? <>Update {TYPE_DISPLAY_LABELS[typeId]}</>
                  : <>Create {TYPE_DISPLAY_LABELS[typeId]}</>
              }
            </button>

            {/* Banners */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 font-medium break-words">{error}</p>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <CheckCircle size={14} className="text-green-600 shrink-0 mt-0.5" />
                <p className="text-xs text-green-700 font-medium">{success}</p>
              </div>
            )}
          </div>

          {/* ── Existing locations tree ─────────────────────────────── */}
          <div className="p-4 space-y-1">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">
              Existing Locations ({flatLocs.length})
            </p>
            {loadingList && flatLocs.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : flatLocs.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No locations yet — create one above.</p>
            ) : (
              flatLocs.map(loc => {
                const depth = Math.max(0, loc.path.split(' > ').length - 1)
                const typeLabel = TYPE_DISPLAY_LABELS[loc.typeId] ?? 'Location'
                const isEditing = editingId === loc.id
                return (
                  <div
                    key={loc.id}
                    className={`flex items-center justify-between border rounded-lg px-2.5 py-1.5 ${
                      isEditing ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-white'
                    }`}
                    style={{ marginLeft: `${depth * 14}px` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {loc.name} <span className="text-gray-400 font-normal">({loc.shortCode})</span>
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {typeLabel} · #{loc.id}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const full = locations.find(l => l.id === loc.id)
                        if (full) startEdit(full)
                      }}
                      disabled={busy}
                      className="p-1.5 text-blue-600 hover:text-blue-800 disabled:opacity-50 shrink-0"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* ── Debug log (on-screen, no F12 needed) ───────────────── */}
          <div className="px-4 pb-4">
            <button
              onClick={() => setDebugOpen(o => !o)}
              className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase hover:text-gray-600"
            >
              <ChevronDown size={12} className={`transition-transform ${debugOpen ? '' : '-rotate-90'}`} />
              Debug Log ({debugLog.length})
            </button>
            {debugOpen && (
              <div className="mt-2 space-y-1.5 max-h-60 overflow-auto">
                {debugLog.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic">No API calls yet.</p>
                ) : (
                  debugLog.map((d, i) => (
                    <div
                      key={i}
                      className={`text-[10px] font-mono border rounded p-2 ${
                        d.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <p className="font-semibold">
                        {d.ok ? '✓' : '✗'} {d.method} {d.path}
                      </p>
                      <p className="text-gray-600 mt-1 break-all">
                        <span className="font-semibold">→ body:</span> {JSON.stringify(d.body)}
                      </p>
                      <p className="text-gray-800 mt-1 break-all">
                        <span className="font-semibold">← response:</span> {JSON.stringify(d.response)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-3 shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
