// ═══════════════════════════════════════════════════════════════════
// Sales History Cache
//
// JARVISmart's /api/pos/sales endpoint only accepts a single ISO date
// (or a named keyword like 'today'/'week'/'month'). To build a
// historical bar graph we have to loop one call per calendar day and
// aggregate client-side. Past-day data never changes, so we cache
// indefinitely in localStorage; today gets a 5-min TTL.
//
// `getSalesRange` is an async generator that yields each day in
// 8-wide parallel batches, letting the chart populate progressively
// instead of blocking on the slowest call.
// ═══════════════════════════════════════════════════════════════════

import { getSalesSummary, type SalesSummary } from './jarvis'

const CACHE_PREFIX = 'liquor-manager-sales-daily-'
const TODAY_TTL_MS = 5 * 60 * 1000     // refresh today every 5 min
const PARALLEL_BATCH = 8                // concurrent requests per chunk

interface CachedDay {
  iso: string
  data: SalesSummary
  cachedAt: number
}

/** Format a Date as YYYY-MM-DD in local time (matches POS day boundaries). */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD as a local-time Date at 00:00. */
export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Enumerate all ISO dates in [from, to] inclusive, oldest first. */
export function enumerateDates(from: Date, to: Date): string[] {
  const out: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Fetch a single day's SalesSummary, hitting localStorage first.
 * Past dates are cached forever; today is refetched after 5 min.
 */
export async function getSalesForDate(iso: string): Promise<SalesSummary> {
  const today = isoDate(new Date())
  const key = CACHE_PREFIX + iso
  const raw = localStorage.getItem(key)
  if (raw) {
    try {
      const c = JSON.parse(raw) as CachedDay
      const stale = iso === today && (Date.now() - c.cachedAt) > TODAY_TTL_MS
      if (!stale && c.data) return c.data
    } catch {
      // Corrupt entry — fall through and refetch
    }
  }
  const data = await getSalesSummary(iso)
  try {
    const entry: CachedDay = { iso, data, cachedAt: Date.now() }
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // localStorage full — non-fatal, just won't cache this entry
  }
  return data
}

/**
 * Yield each day's sales in [from, to] inclusive, oldest first,
 * fetched in parallel batches of 8 so the UI can render bars as
 * data arrives. Failed days yield `data: null`.
 */
export async function* getSalesRange(
  from: Date,
  to: Date,
): AsyncGenerator<{ iso: string; data: SalesSummary | null }> {
  const dates = enumerateDates(from, to)
  for (let i = 0; i < dates.length; i += PARALLEL_BATCH) {
    const slice = dates.slice(i, i + PARALLEL_BATCH)
    const results = await Promise.allSettled(slice.map(getSalesForDate))
    for (let j = 0; j < slice.length; j++) {
      yield {
        iso: slice[j],
        data: results[j].status === 'fulfilled'
          ? (results[j] as PromiseFulfilledResult<SalesSummary>).value
          : null,
      }
    }
  }
}
