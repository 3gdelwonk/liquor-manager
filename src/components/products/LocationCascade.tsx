import { createLocation } from '../../lib/jarvisActions'
import { getDisplayLabel } from '../../lib/locationUtils'

// ─── Cascade option type ────────────────────────────────────────────────────

export interface LevelOption {
  id: number
  name: string
  shortCode: string
  path: string
}

// ─── Per-level column: dropdown + name + code, always visible ───────────────

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
  const locked = !!selectedId
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
      </select>
      <input
        type="text"
        value={name}
        onChange={e => onName(e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder="New name"
        disabled={busy}
        className={`w-full border border-blue-200 rounded-lg px-1.5 py-1.5 text-[11px] focus:ring-2 focus:ring-blue-300 disabled:opacity-50 ${
          locked ? 'bg-gray-50 text-gray-400' : 'bg-white'
        }`}
      />
      <input
        type="text"
        value={code}
        onChange={e => onCode(e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder="Code"
        disabled={busy}
        className={`w-full border border-blue-200 rounded-lg px-1.5 py-1.5 text-[11px] focus:ring-2 focus:ring-blue-300 disabled:opacity-50 ${
          locked ? 'bg-gray-50 text-gray-400' : 'bg-white'
        }`}
      />
    </div>
  )
}

// ─── Walker: resolves a leaf id from any subset of levels ───────────────────
//
// For each level top→down:
//   • existing id picked  → use it, advance parent
//   • name+code filled    → create under running parent, advance parent
//   • both empty          → skip, keep parent unchanged (gap-skipping)
//
// Returns the deepest resolved id, or null if nothing resolved.

export interface CascadeLevel {
  id: number | ''
  name: string
  code: string
  typeId: number
}

export async function resolveTargetLocation(
  levels: CascadeLevel[],
  onError: (msg: string) => void,
): Promise<number | null> {
  let parentId: number | undefined = undefined
  let finalId: number | undefined = undefined

  for (const level of levels) {
    if (level.id) {
      parentId = Number(level.id)
      finalId = parentId
    } else if (level.name.trim() && level.code.trim()) {
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
    }
    // else: empty level → skip, parent unchanged
  }

  return finalId ?? null
}

// ─── Convenience predicate: does the user have any input at all? ────────────

export function hasAnyCascadeInput(levels: CascadeLevel[]): boolean {
  return levels.some(
    l => !!l.id || (!!l.name.trim() && !!l.code.trim())
  )
}
