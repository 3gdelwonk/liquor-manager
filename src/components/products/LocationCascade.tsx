// ─── Cascade option type ────────────────────────────────────────────────────

export interface LevelOption {
  id: number
  name: string
  shortCode: string
  path: string
}

// ─── Per-level column: existing-only dropdown ───────────────────────────────
//
// Dropdown values:
//   ''  → nothing picked (skipped on submit)
//   >0  → existing location id
//
// New-location creation is handled by CreateLocationDialog, not inline here.

export function LocationLevelColumn({
  label,
  options,
  selectedId,
  onSelectId,
  busy,
}: {
  label: string
  options: LevelOption[]
  selectedId: number | ''
  onSelectId: (id: number | '') => void
  busy: boolean
}) {
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
    </div>
  )
}

// ─── Walker: returns the deepest picked level id ────────────────────────────

export interface CascadeLevel {
  id: number | ''
  typeId: number
}

export function resolveTargetLocation(levels: CascadeLevel[]): number | null {
  let finalId: number | null = null
  for (const level of levels) {
    if (typeof level.id === 'number' && level.id > 0) {
      finalId = level.id
    }
  }
  return finalId
}

// ─── Convenience predicate: does the user have any usable pick? ─────────────

export function hasAnyCascadeInput(levels: CascadeLevel[]): boolean {
  return levels.some(l => typeof l.id === 'number' && l.id > 0)
}
