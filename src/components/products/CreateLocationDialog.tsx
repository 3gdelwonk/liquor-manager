import { useState, useMemo, useEffect } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import type { StockLocation } from '../../lib/jarvis'
import { createLocation } from '../../lib/jarvisActions'
import { buildLocationTree, flattenLocations, TYPE_DISPLAY_LABELS } from '../../lib/locationUtils'

// Parent type for each level. Zone has no parent.
const PARENT_TYPE: Record<number, number | null> = {
  4: null, // Zone → (root)
  1: 4,    // Aisle → Zone
  2: 1,    // Bay → Aisle
  3: 2,    // Shelf → Bay
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (newId: number, typeId: number) => void
  allLocations: StockLocation[]
  initialTypeId?: number
  initialParentId?: number
}

export default function CreateLocationDialog({
  open,
  onClose,
  onCreated,
  allLocations,
  initialTypeId = 4,
  initialParentId,
}: Props) {
  const [typeId, setTypeId] = useState<number>(initialTypeId)
  const [parentId, setParentId] = useState<number | ''>(initialParentId ?? '')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setTypeId(initialTypeId)
      setParentId(initialParentId ?? '')
      setName('')
      setCode('')
      setError(null)
      setBusy(false)
    }
  }, [open, initialTypeId, initialParentId])

  const flatLocs = useMemo(() => {
    const tree = buildLocationTree(allLocations)
    return flattenLocations(tree)
  }, [allLocations])

  const parentTypeId = PARENT_TYPE[typeId]
  const parentOptions = useMemo(() => {
    if (parentTypeId == null) return []
    return flatLocs.filter(l => l.typeId === parentTypeId)
  }, [flatLocs, parentTypeId])

  // If user switches type, parentId might be invalid — reset
  useEffect(() => {
    if (parentTypeId == null) {
      setParentId('')
      return
    }
    if (parentId !== '' && !parentOptions.some(o => o.id === parentId)) {
      setParentId('')
    }
  }, [typeId, parentTypeId, parentOptions, parentId])

  async function handleCreate() {
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!code.trim()) {
      setError('Code is required')
      return
    }
    if (parentTypeId != null && parentId === '') {
      setError(`Select a ${TYPE_DISPLAY_LABELS[parentTypeId]} as parent`)
      return
    }
    setBusy(true)
    try {
      const res = await createLocation(
        name.trim(),
        code.trim(),
        typeId,
        parentTypeId != null ? (parentId as number) : undefined,
      )
      if (res.success && res.id) {
        onCreated(res.id, typeId)
        onClose()
      } else if (res.message) {
        setError(res.message)
      } else {
        // Unexpected shape — surface the raw JSON so we can see what the server returned
        const rawStr = res.raw ? JSON.stringify(res.raw) : '(empty)'
        setError(`Unexpected server response: ${rawStr}`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Plus size={16} className="text-blue-600" /> Create Location
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Type */}
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Type</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[4, 1, 2, 3].map(t => (
                <button
                  key={t}
                  onClick={() => setTypeId(t)}
                  disabled={busy}
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

          {/* Parent (only for non-Zone) */}
          {parentTypeId != null && (
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
              placeholder={`e.g. ${typeId === 4 ? 'Wine Zone' : typeId === 1 ? 'Aisle 1' : typeId === 2 ? 'Bay A' : 'Shelf 1'}`}
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

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs text-red-700 font-medium">{error}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy ? <><Loader2 size={14} className="animate-spin" /> Creating...</> : <>Create {TYPE_DISPLAY_LABELS[typeId]}</>}
          </button>
        </div>
      </div>
    </div>
  )
}
