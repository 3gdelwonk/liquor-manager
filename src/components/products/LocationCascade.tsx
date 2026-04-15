import { useRef, useState, useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

// ─── Cascade option type ────────────────────────────────────────────────────

export interface LevelOption {
  id: number
  name: string
  shortCode: string
  path: string
}

// ─── Short-code prefix extractor ────────────────────────────────────────────
// Used by the bay picker to chunk chips into groups. A prefix is the leading
// alpha run of the shortCode (letters before any digit):
//   "WWB1"  → "WWB"     "WWB2"  → "WWB"
//   "PMB1"  → "PMB"     "PMB12" → "PMB"
//   "PB1"   → "PB"
//   "B3"    → "B"
//   "A"     → "A"
// Falls back to the whole shortCode if nothing matches, and to "—" for empty.
function getShortCodePrefix(code: string): string {
  if (!code) return '—'
  const m = code.match(/^[A-Za-z]+/)
  if (m) return m[0].toUpperCase()
  return code.trim() || '—'
}

interface PrefixGroup {
  prefix: string
  items: LevelOption[]
}

function groupByPrefixFn(options: LevelOption[]): PrefixGroup[] {
  const groups = new Map<string, LevelOption[]>()
  const order: string[] = []
  for (const o of options) {
    const key = getShortCodePrefix(o.shortCode || o.name || '')
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(o)
  }
  return order.map(k => ({ prefix: k, items: groups.get(k)! }))
}

// ─── Per-level row: chip-button picker ──────────────────────────────────────
//
// Tap-friendly: each option is a real <button>, not a native <select>. Native
// <select> can be flaky inside scrollable PWA panels on Android — buttons
// always respond to taps and visibly show the picked state. Tap a picked chip
// to clear it.
//
// Long-press (touch-hold or mouse-hold ≥450ms, or right-click on desktop)
// reveals a tooltip bubble with the full `name` and `path` — PWAs hide the
// native `title` tooltip on touch, so we render our own.
//
// Selection values:
//   ''  → nothing picked (skipped on submit)
//   >0  → existing location id
//
// New-location creation is handled by LocationManagerDialog, not inline here.

const LONG_PRESS_MS = 450

export function LocationLevelColumn({
  label,
  options,
  selectedId,
  onSelectId,
  busy,
  groupByPrefix = false,
}: {
  label: string
  options: LevelOption[]
  selectedId: number | ''
  onSelectId: (id: number | '') => void
  busy: boolean
  groupByPrefix?: boolean
}) {
  const isEmpty = options.length === 0

  // Long-press state is shared across all chips in this column.
  const [revealed, setRevealed] = useState<number | null>(null)
  const pressTimer = useRef<number | null>(null)
  const pressedLong = useRef(false)

  // Clear the revealed tooltip if the option list changes (e.g. parent pick
  // switched). Avoids a stale bubble pointing at a chip that no longer exists.
  useEffect(() => {
    setRevealed(null)
  }, [options])

  useEffect(() => () => {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current)
  }, [])

  function startPress(id: number) {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current)
    pressedLong.current = false
    pressTimer.current = window.setTimeout(() => {
      pressedLong.current = true
      setRevealed(id)
      pressTimer.current = null
    }, LONG_PRESS_MS)
  }

  function cancelPress() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  function handleChipClick(e: ReactMouseEvent, o: LevelOption, picked: boolean) {
    e.stopPropagation()
    // A long-press just fired — swallow the click so the tooltip stays up
    // and the user doesn't accidentally select the chip they were peeking at.
    if (pressedLong.current) {
      pressedLong.current = false
      return
    }
    setRevealed(null)
    onSelectId(picked ? '' : o.id)
  }

  function renderChip(o: LevelOption) {
    const picked = selectedId === o.id
    const showBubble = revealed === o.id
    return (
      <span key={o.id} className="relative inline-block">
        <button
          type="button"
          disabled={busy}
          onClick={(e) => handleChipClick(e, o, picked)}
          onContextMenu={(e) => { e.preventDefault(); setRevealed(showBubble ? null : o.id) }}
          onTouchStart={() => startPress(o.id)}
          onTouchEnd={cancelPress}
          onTouchMove={cancelPress}
          onTouchCancel={cancelPress}
          onMouseDown={() => startPress(o.id)}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border-2 transition-colors disabled:opacity-50 ${
            picked
              ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
              : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400 active:bg-blue-50'
          }`}
          title={o.path}
        >
          {o.shortCode || o.name}
        </button>
        {showBubble && (
          <span
            className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none"
            role="tooltip"
          >
            <span className="block px-3 py-1.5 rounded-lg bg-blue-700 text-white shadow-xl ring-2 ring-blue-200 whitespace-nowrap">
              <span className="block text-[9px] font-semibold uppercase tracking-wide text-blue-200">
                {o.shortCode || '—'}
              </span>
              <span className="block text-[12px] font-bold leading-tight">
                {o.name || o.shortCode}
              </span>
              {o.path && o.path !== o.name && (
                <span className="block text-[10px] font-normal text-blue-100 mt-0.5">
                  {o.path}
                </span>
              )}
            </span>
            <span
              className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0"
              style={{
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '5px solid rgb(29 78 216)',
              }}
            />
          </span>
        )}
      </span>
    )
  }

  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold text-blue-500 uppercase block truncate">{label}</label>
        {selectedId !== '' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setRevealed(null); onSelectId('') }}
            disabled={busy}
            className="text-[9px] font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            clear
          </button>
        )}
      </div>
      {isEmpty ? (
        <p className="text-[10px] text-gray-400 italic px-1 py-1">(none)</p>
      ) : groupByPrefix ? (
        <div className="space-y-1.5">
          {groupByPrefixFn(options).map((g, i) => (
            <div
              key={g.prefix}
              className={i > 0 ? 'pt-1.5 border-t border-blue-100' : ''}
            >
              <p className="text-[9px] font-semibold text-blue-400 uppercase tracking-wide mb-1">
                {g.prefix}
              </p>
              <div className="flex flex-wrap gap-1">
                {g.items.map(renderChip)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {options.map(renderChip)}
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
