import { createLocation } from '../../lib/jarvisActions'
import { getDisplayLabel } from '../../lib/locationUtils'

// ─── Cascade option type ────────────────────────────────────────────────────

export interface LevelOption {
  id: number
  name: string
  shortCode: string
  path: string
}

// ─── Per-level column: dropdown with "+ New" option ─────────────────────────
//
// Dropdown values:
//   ''  → nothing picked (skipped on submit)
//   >0  → existing location id (used as-is)
//   -1  → "+ New" mode → reveals Name + Code inputs; created on submit

export function LocationLevelColumn({
  label,
  options,
  selectedId,
  name,
  code,
  onSelectId,
  onName,
  onCode,
  busy,
}: {
  label: string
  options: LevelOption[]
  selectedId: number | ''
  name: string
  code: string
  onSelectId: (id: number | '') => void
  onName: (v: string) => void
  onCode: (v: string) => void
  busy: boolean
}) {
  const isNew = selectedId === -1
  return (
    <div className="space-y-1 min-w-0">
      <label className="text-[9px] font-semibold text-blue-400 uppercase block truncate">{label}</label>
      <select
        value={selectedId === '' ? '' : String(selectedId)}
        onChange={e => {
          const v = e.target.value ? Number(e.target.value) : ''
          onSelectId(v)
        }}
        onClick={e => e.stopPropagation()}
        disabled={busy}
        className="w-full border border-blue-200 rounded-lg px-1.5 py-1.5 text-[11px] bg-white focus:ring-2 focus:ring-blue-300 disabled:opacity-50 truncate"
      >
        <option value="">—</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.shortCode || o.name}</option>
        ))}
        <option value="-1">+ New</option>
      </select>
      {isNew && (
        <>
          <input
            type="text"
            value={name}
            onChange={e => onName(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder="New name"
            disabled={busy}
            className="w-full border border-blue-200 rounded-lg px-1.5 py-1.5 text-[11px] bg-white focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
          />
          <input
            type="text"
            value={code}
            onChange={e => onCode(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder="Code"
            disabled={busy}
            className="w-full border border-blue-200 rounded-lg px-1.5 py-1.5 text-[11px] bg-white focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
          />
        </>
      )}
    </div>
  )
}

// ─── Walker: resolves a leaf id from any subset of levels ───────────────────
//
// For each level top→down:
//   • id > 0 (existing pick)               → use it, advance parent
//   • id === -1 + name+code filled          → create under running parent, advance
//   • id === '' (skipped) or -1 with blanks → skip, parent unchanged
//
// Returns the deepest resolved id, or null if nothing resolved.

export interface CascadeLevel {
  id: number | ''
  name: string
  code: string
  typeId: number
}

export interface ResolveResult {
  finalId: number
  /** Real IDs for each level (keyed by typeId). Only includes levels that resolved. */
  resolvedIds: Record<number, number>
}

export async function resolveTargetLocation(
  levels: CascadeLevel[],
  onError: (msg: string) => void,
): Promise<ResolveResult | null> {
  let parentId: number | undefined = undefined
  let finalId: number | undefined = undefined
  const resolvedIds: Record<number, number> = {}

  for (const level of levels) {
    if (typeof level.id === 'number' && level.id > 0) {
      parentId = level.id
      finalId = level.id
      resolvedIds[level.typeId] = level.id
    } else if (level.id === -1 && level.name.trim() && level.code.trim()) {
      const res = await createLocation(
        level.name.trim(),
        level.code.trim(),
        level.typeId,
        parentId,
      )
      if (!res.success || !res.id) {
        onError(res.message ?? `Failed to create ${getDisplayLabel(level.typeId)}`)
        return null
      }
      parentId = res.id
      finalId = res.id
      resolvedIds[level.typeId] = res.id
    }
    // else: empty / incomplete new → skip, parent unchanged
  }

  return finalId != null ? { finalId, resolvedIds } : null
}

// ─── Convenience predicate: does the user have any usable input? ────────────

export function hasAnyCascadeInput(levels: CascadeLevel[]): boolean {
  return levels.some(
    l =>
      (typeof l.id === 'number' && l.id > 0) ||
      (l.id === -1 && !!l.name.trim() && !!l.code.trim())
  )
}
