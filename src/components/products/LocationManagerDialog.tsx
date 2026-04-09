import { useState, useMemo, useEffect, useCallback } from 'react'
import { Loader2, Plus, X, Pencil, CheckCircle, AlertCircle, ChevronDown, Check } from 'lucide-react'
import type { StockLocation } from '../../lib/jarvis'
import { getLocations } from '../../lib/jarvis'
import { createLocation, updateLocation } from '../../lib/jarvisActions'
import { buildLocationTree, flattenLocations, TYPE_DISPLAY_LABELS } from '../../lib/locationUtils'

// Level order top→down. typeId 4=Zone, 1=Aisle, 2=Bay, 3=Row.
const LEVELS: number[] = [4, 1, 2, 3]

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

type Mode =
  | { kind: 'idle' }
  | { kind: 'create'; typeId: number; parentId: number | null }
  | { kind: 'edit'; id: number; typeId: number; parentId: number | null }

export default function LocationManagerDialog({
  open,
  onClose,
  onCreated,
  initialTypeId = 4,
  initialParentId,
}: Props) {
  // Dialog-local location store (with optimistic adds that survive server GET lag)
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // Cascading selection — user navigates the tree by picking at each level
  const [selected, setSelected] = useState<Record<number, number | null>>({ 4: null, 1: null, 2: null, 3: null })

  // Form state
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  // UI feedback
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // On-screen debug log (replaces F12 devtools on mobile)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([])

  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(locations)
    return flattenLocations(tree)
  }, [locations])

  // Options for each level, filtered by the selection at the parent level
  const optionsByLevel = useMemo(() => {
    const zones = flatLocs.filter(l => l.typeId === 4)
    const aisles = flatLocs.filter(l => l.typeId === 1 && (selected[4] == null || l.parentId === selected[4]))
    const bays = flatLocs.filter(l => l.typeId === 2 && (selected[1] == null || l.parentId === selected[1]))
    const rows = flatLocs.filter(l => l.typeId === 3 && (selected[2] == null || l.parentId === selected[2]))
    return { 4: zones, 1: aisles, 2: bays, 3: rows }
  }, [flatLocs, selected])

  const loadLocations = useCallback(async () => {
    setLoadingList(true)
    try {
      const all = await getLocations()
      const filtered = all.filter(l => l.active)
      // Merge: preserve any locally-added entries the server GET didn't yet return
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

  // Reset + load when opened
  useEffect(() => {
    if (!open) return
    setName('')
    setCode('')
    setError(null)
    setSuccess(null)
    setMode({ kind: 'idle' })
    setSelected({
      4: initialTypeId === 4 ? null : (initialParentId ?? null),
      1: initialTypeId === 1 ? null : null,
      2: initialTypeId === 2 ? null : null,
      3: initialTypeId === 3 ? null : null,
    })
    setBusy(false)
    setLocations([])
    loadLocations()
  }, [open, initialTypeId, initialParentId, loadLocations])

  function addDebug(entry: DebugEntry) {
    setDebugLog(prev => [entry, ...prev].slice(0, 10))
  }

  // Picking a level locks it as parent context and clears any deeper selections
  function pickLevel(typeId: number, id: number | null) {
    setSelected(prev => {
      const next = { ...prev, [typeId]: id }
      // Clear children when parent changes
      const idx = LEVELS.indexOf(typeId)
      for (let i = idx + 1; i < LEVELS.length; i++) next[LEVELS[i]] = null
      return next
    })
    // Exit form mode if user navigates
    setMode({ kind: 'idle' })
    setError(null)
    setSuccess(null)
  }

  // Parent id for creating a child at the given level
  function parentForLevel(typeId: number): number | null {
    if (typeId === 4) return null // Zone has no parent
    if (typeId === 1) return selected[4]
    if (typeId === 2) return selected[1]
    if (typeId === 3) return selected[2]
    return null
  }

  function startCreate(typeId: number) {
    const parent = parentForLevel(typeId)
    if (typeId !== 4 && parent == null) {
      setError(`Select a parent ${TYPE_DISPLAY_LABELS[typeId === 1 ? 4 : typeId === 2 ? 1 : 2]} first`)
      return
    }
    setMode({ kind: 'create', typeId, parentId: parent })
    setName('')
    setCode('')
    setError(null)
    setSuccess(null)
  }

  function startEdit(typeId: number) {
    const id = selected[typeId]
    if (id == null) return
    const loc = locations.find(l => l.id === id)
    if (!loc) return
    setMode({ kind: 'edit', id, typeId, parentId: loc.parentId })
    setName(loc.name)
    setCode(loc.shortCode)
    setError(null)
    setSuccess(null)
  }

  function cancelForm() {
    setMode({ kind: 'idle' })
    setName('')
    setCode('')
    setError(null)
  }

  async function handleSubmit() {
    if (mode.kind === 'idle') return
    setError(null)
    setSuccess(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (!code.trim()) { setError('Code is required'); return }

    setBusy(true)
    try {
      if (mode.kind === 'edit') {
        const payload = { name: name.trim(), shortCode: code.trim() }
        const res = await updateLocation(mode.id, payload)
        addDebug({
          method: 'PUT',
          path: `/api/pos/locations/${mode.id}`,
          body: payload,
          response: res.raw ?? res,
          ok: res.success,
          ts: Date.now(),
        })
        if (res.success) {
          setSuccess(`Updated "${name.trim()}"`)
          setLocations(prev => prev.map(l =>
            l.id === mode.id ? { ...l, name: name.trim(), shortCode: code.trim() } : l
          ))
          setMode({ kind: 'idle' })
          setName('')
          setCode('')
          await loadLocations()
        } else {
          setError(res.message || `Unexpected response: ${JSON.stringify(res.raw ?? res) || '(empty)'}`)
          setDebugOpen(true)
        }
      } else {
        // create
        const payload: Record<string, unknown> = {
          name: name.trim(),
          shortCode: code.trim(),
          typeId: mode.typeId,
        }
        if (mode.parentId != null) payload.parentId = mode.parentId
        const res = await createLocation(
          name.trim(),
          code.trim(),
          mode.typeId,
          mode.parentId ?? undefined,
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
            typeId: mode.typeId,
            name: name.trim(),
            shortCode: code.trim(),
            parentId: mode.parentId,
          }
          setSuccess(`Created ${TYPE_DISPLAY_LABELS[mode.typeId]} "${created.name}" (#${created.id})`)
          // Optimistic add
          setLocations(prev =>
            prev.some(l => l.id === created.id)
              ? prev
              : [...prev, { ...created, active: true } as StockLocation]
          )
          // Auto-select in cascade at its level
          setSelected(prev => ({ ...prev, [mode.typeId]: created.id }))
          // Notify parent (for optimistic add + pre-select in parent cascade)
          onCreated(created)
          // Clear form, close form mode
          setMode({ kind: 'idle' })
          setName('')
          setCode('')
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

  const formActive = mode.kind !== 'idle'

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
          {/* ── Cascade picker with per-level + / edit ─────────────── */}
          <div className="p-4 space-y-2.5 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-500 uppercase">
              Navigate Tree
              {loadingList && <Loader2 size={10} className="inline ml-1 animate-spin" />}
            </p>
            {LEVELS.map(typeId => {
              const opts = optionsByLevel[typeId as 1 | 2 | 3 | 4]
              const value = selected[typeId]
              const addDisabled = typeId !== 4 && parentForLevel(typeId) == null
              const editDisabled = value == null
              return (
                <div key={typeId} className="space-y-1">
                  <label className="text-[9px] font-semibold text-blue-500 uppercase block">
                    {TYPE_DISPLAY_LABELS[typeId]}
                  </label>
                  <div className="flex gap-1.5">
                    <select
                      value={value == null ? '' : String(value)}
                      onChange={e => pickLevel(typeId, e.target.value ? Number(e.target.value) : null)}
                      disabled={busy || opts.length === 0}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white disabled:opacity-50 disabled:bg-gray-50"
                    >
                      <option value="">
                        {opts.length === 0
                          ? `No ${TYPE_DISPLAY_LABELS[typeId]}s yet`
                          : `— Pick ${TYPE_DISPLAY_LABELS[typeId]} —`}
                      </option>
                      {opts.map(o => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.shortCode})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => startCreate(typeId)}
                      disabled={busy || addDisabled}
                      className="px-2.5 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-30 flex items-center"
                      title={addDisabled ? 'Select a parent first' : `Add ${TYPE_DISPLAY_LABELS[typeId]}`}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={() => startEdit(typeId)}
                      disabled={busy || editDisabled}
                      className="px-2.5 py-2 border border-gray-200 text-gray-600 rounded-lg disabled:opacity-30 flex items-center"
                      title={editDisabled ? 'Select a location first' : `Edit ${TYPE_DISPLAY_LABELS[typeId]}`}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Form panel (appears when creating/editing) ──────────── */}
          {formActive && (
            <div className="p-4 space-y-3 border-b border-gray-100 bg-blue-50/40">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-700">
                  {mode.kind === 'create'
                    ? `New ${TYPE_DISPLAY_LABELS[mode.typeId]}`
                    : `Edit ${TYPE_DISPLAY_LABELS[mode.typeId]}`}
                </p>
                <button
                  onClick={cancelForm}
                  disabled={busy}
                  className="text-[11px] text-gray-500 hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>

              {/* Parent context (read-only, derived from cascade) */}
              {mode.kind === 'create' && mode.parentId != null && (
                <p className="text-[11px] text-gray-500">
                  Under:{' '}
                  <span className="font-medium text-gray-700">
                    {locations.find(l => l.id === mode.parentId)?.name ?? `#${mode.parentId}`}
                  </span>
                </p>
              )}

              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={`e.g. ${
                    mode.typeId === 4 ? 'Wine Zone'
                    : mode.typeId === 1 ? 'Aisle 1'
                    : mode.typeId === 2 ? 'Bay A' : 'Row 1'
                  }`}
                  disabled={busy}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Short Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder={`e.g. ${
                    mode.typeId === 4 ? 'WZ'
                    : mode.typeId === 1 ? 'A1'
                    : mode.typeId === 2 ? 'BA' : 'R1'
                  }`}
                  disabled={busy}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={busy}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {busy
                  ? <><Loader2 size={14} className="animate-spin" /> Saving...</>
                  : mode.kind === 'edit'
                    ? <><Check size={14} /> Update {TYPE_DISPLAY_LABELS[mode.typeId]}</>
                    : <><Plus size={14} /> Create {TYPE_DISPLAY_LABELS[mode.typeId]}</>}
              </button>
            </div>
          )}

          {/* ── Banners ─────────────────────────────────────────────── */}
          {(error || success) && (
            <div className="px-4 pt-3 space-y-2">
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
          )}

          {/* ── Debug log (on-screen, no F12 needed) ───────────────── */}
          <div className="px-4 pb-4 pt-3">
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
