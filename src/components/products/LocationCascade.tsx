// ─── Cascade option type ────────────────────────────────────────────────────

export interface LevelOption {
  id: number
  name: string
  shortCode: string
  path: string
}

// ─── Per-level row: chip-button picker ──────────────────────────────────────
//
// Tap-friendly: each option is a real <button>, not a native <select>. Native
// <select> can be flaky inside scrollable PWA panels on Android — buttons
// always respond to taps and visibly show the picked state. Tap a picked chip
// to clear it.
//
// Selection values:
//   ''  → nothing picked (skipped on submit)
//   >0  → existing location id
//
// New-location creation is handled by LocationManagerDialog, not inline here.

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
  const isEmpty = options.length === 0
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold text-blue-500 uppercase block truncate">{label}</label>
        {selectedId !== '' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectId('') }}
            disabled={busy}
            className="text-[9px] font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            clear
          </button>
        )}
      </div>
      {isEmpty ? (
        <p className="text-[10px] text-gray-400 italic px-1 py-1">(none)</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {options.map(o => {
            const picked = selectedId === o.id
            return (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); onSelectId(picked ? '' : o.id) }}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border-2 transition-colors disabled:opacity-50 ${
                  picked
                    ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                    : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400 active:bg-blue-50'
                }`}
                title={o.path}
              >
                {o.shortCode || o.name}
              </button>
            )
          })}
        </div>
      )}
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
