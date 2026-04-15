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

interface RevealState {
  id: number
  x: number      // viewport x of chip center
  top: number    // viewport y of chip top
}

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

  // Long-press state is shared across all chips in this column. Positioned
  // via viewport coordinates so the bubble escapes any parent overflow/
  // clipping and can be clamped to stay on-screen at corner chips.
  const [revealed, setRevealed] = useState<RevealState | null>(null)
  const pressTimer = useRef<number | null>(null)
  const pressedLong = useRef(false)

  // Clear the revealed tooltip if the option list changes (e.g. parent pick
  // switched). Avoids a stale bubble pointing at a chip that no longer exists.
  useEffect(() => {
    setRevealed(null)
  }, [options])

  // Dismiss on scroll/resize — the cached coords would otherwise drift.
  useEffect(() => {
    if (!revealed) return
    const dismiss = () => setRevealed(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [revealed])

  useEffect(() => () => {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current)
  }, [])

  function reveal(id: number, el: HTMLElement | null) {
    if (!el) return
    const r = el.getBoundingClientRect()
    setRevealed({ id, x: r.left + r.width / 2, top: r.top })
  }

  function startPress(id: number, el: HTMLElement | null) {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current)
    pressedLong.current = false
    pressTimer.current = window.setTimeout(() => {
      pressedLong.current = true
      reveal(id, el)
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
    return (
      <button
        key={o.id}
        type="button"
        disabled={busy}
        onClick={(e) => handleChipClick(e, o, picked)}
        onContextMenu={(e) => {
          e.preventDefault()
          if (revealed?.id === o.id) setRevealed(null)
          else reveal(o.id, e.currentTarget)
        }}
        onTouchStart={(e) => startPress(o.id, e.currentTarget)}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onTouchCancel={cancelPress}
        onMouseDown={(e) => startPress(o.id, e.currentTarget)}
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
    )
  }

  // Viewport-fixed tooltip — rendered at the column level so it escapes any
  // parent overflow clipping, and clamped horizontally to stay on-screen
  // when the revealed chip is near the left or right edge.
  function renderRevealTooltip() {
    if (!revealed) return null
    const opt = options.find(o => o.id === revealed.id)
    if (!opt) return null
    const BUBBLE_MAX = 260
    const HALF = BUBBLE_MAX / 2
    const MARGIN = 8
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400
    const clampedX = Math.max(HALF + MARGIN, Math.min(vw - HALF - MARGIN, revealed.x))
    const arrowOffset = revealed.x - clampedX  // px the arrow shifts from center
    return (
      <div
        role="tooltip"
        style={{
          position: 'fixed',
          left: clampedX,
          top: revealed.top,
          transform: 'translate(-50%, calc(-100% - 10px))',
          maxWidth: BUBBLE_MAX,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        <div className="px-3 py-2 rounded-lg bg-blue-700 text-white shadow-2xl ring-2 ring-blue-300">
          <div className="text-[9px] font-bold uppercase tracking-wider text-blue-200">
            {opt.shortCode || '—'}
          </div>
          <div className="text-[13px] font-bold leading-tight mt-0.5 break-words whitespace-normal">
            {opt.name || opt.shortCode}
          </div>
          {opt.path && opt.path !== opt.name && (
            <div className="text-[10px] font-normal text-blue-100 mt-1 break-words whitespace-normal">
              {opt.path}
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            left: `calc(50% + ${arrowOffset}px)`,
            top: '100%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid rgb(29 78 216)',
          }}
        />
      </div>
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
      {renderRevealTooltip()}
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
