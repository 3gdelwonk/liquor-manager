import type { Product, SalesRecord } from './types'
import type { TrackedItem, TrackedPromo } from './db'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDateDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function salesForProduct(
  records: SalesRecord[],
  barcode: string,
  productId: number | undefined,
  start: string,
  end: string,
): SalesRecord[] {
  return records.filter(r => {
    const match = r.barcode === barcode || (productId !== undefined && r.productId === productId)
    return match && r.date >= start && r.date <= end
  })
}

// ─── Category Momentum ───────────────────────────────────────────────────────
// Compare 28d revenue by category vs previous 28d

export interface CategoryMomentum {
  category: string
  currentRevenue: number
  previousRevenue: number
  changePercent: number
}

export function categoryMomentum(
  products: Product[],
  salesRecords: SalesRecord[],
): CategoryMomentum[] {
  const today = isoToday()
  const start28 = isoDateDaysAgo(28)
  const start56 = isoDateDaysAgo(56)

  const byCategory = new Map<string, Product[]>()
  for (const p of products) {
    const arr = byCategory.get(p.category) ?? []
    arr.push(p)
    byCategory.set(p.category, arr)
  }

  const results: CategoryMomentum[] = []

  for (const [cat, prods] of byCategory) {
    let current = 0
    let previous = 0

    for (const p of prods) {
      const recentRecs = salesForProduct(salesRecords, p.barcode, p.id, start28, today)
      const prevRecs = salesForProduct(salesRecords, p.barcode, p.id, start56, start28)
      current += recentRecs.reduce((s, r) => s + r.salesValue, 0)
      previous += prevRecs.reduce((s, r) => s + r.salesValue, 0)
    }

    const changePercent = previous > 0
      ? ((current - previous) / previous) * 100
      : current > 0 ? 100 : 0

    results.push({ category: cat, currentRevenue: current, previousRevenue: previous, changePercent })
  }

  return results.sort((a, b) => b.changePercent - a.changePercent)
}

// ─── Top Risers / Fallers ────────────────────────────────────────────────────
// Products with biggest velocity % change (28d vs prev 28d)

export interface VelocityMover {
  product: Product
  currentVelocity: number
  previousVelocity: number
  changePercent: number
}

export function topMovers(
  products: Product[],
  salesRecords: SalesRecord[],
  count = 5,
): { risers: VelocityMover[]; fallers: VelocityMover[] } {
  const today = isoToday()
  const start28 = isoDateDaysAgo(28)
  const start56 = isoDateDaysAgo(56)

  const movers: VelocityMover[] = []

  for (const p of products) {
    if (p.id === undefined) continue
    const recentRecs = salesForProduct(salesRecords, p.barcode, p.id, start28, today)
    const prevRecs = salesForProduct(salesRecords, p.barcode, p.id, start56, start28)

    const currentQty = recentRecs.reduce((s, r) => s + r.qtySold, 0)
    const prevQty = prevRecs.reduce((s, r) => s + r.qtySold, 0)

    const currentVelocity = currentQty / 28
    const previousVelocity = prevQty / 28

    // Only include products with meaningful sales in at least one period
    if (currentQty === 0 && prevQty === 0) continue

    const changePercent = previousVelocity > 0
      ? ((currentVelocity - previousVelocity) / previousVelocity) * 100
      : currentVelocity > 0 ? 100 : 0

    movers.push({ product: p, currentVelocity, previousVelocity, changePercent })
  }

  const sorted = [...movers].sort((a, b) => b.changePercent - a.changePercent)
  const risers = sorted.filter(m => m.changePercent > 0).slice(0, count)
  const fallers = sorted.filter(m => m.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, count)

  return { risers, fallers }
}

// ─── Price Impact ────────────────────────────────────────────────────────────
// For each tracked price change: 14d revenue before vs 14d after

export interface PriceImpact {
  item: TrackedItem
  revenueBefore: number
  revenueAfter: number
  qtyBefore: number
  qtyAfter: number
  revenueChange: number
  revenueChangePercent: number
}

export function priceImpacts(
  trackedItems: TrackedItem[],
  salesRecords: SalesRecord[],
): PriceImpact[] {
  const results: PriceImpact[] = []

  for (const item of trackedItems) {
    const changeDate = new Date(item.changeDate)
    const beforeStart = new Date(changeDate)
    beforeStart.setDate(beforeStart.getDate() - 14)
    const afterEnd = new Date(changeDate)
    afterEnd.setDate(afterEnd.getDate() + 14)

    const beforeStartStr = beforeStart.toISOString().slice(0, 10)
    const changeDateStr = item.changeDate
    const afterEndStr = afterEnd.toISOString().slice(0, 10)

    const before = salesRecords.filter(r =>
      r.barcode === (item.barcode ?? item.itemCode) && r.date >= beforeStartStr && r.date < changeDateStr
    )
    const after = salesRecords.filter(r =>
      r.barcode === (item.barcode ?? item.itemCode) && r.date >= changeDateStr && r.date <= afterEndStr
    )

    const revenueBefore = before.reduce((s, r) => s + r.salesValue, 0)
    const revenueAfter = after.reduce((s, r) => s + r.salesValue, 0)
    const qtyBefore = before.reduce((s, r) => s + r.qtySold, 0)
    const qtyAfter = after.reduce((s, r) => s + r.qtySold, 0)

    const revenueChange = revenueAfter - revenueBefore
    const revenueChangePercent = revenueBefore > 0
      ? (revenueChange / revenueBefore) * 100
      : revenueAfter > 0 ? 100 : 0

    results.push({ item, revenueBefore, revenueAfter, qtyBefore, qtyAfter, revenueChange, revenueChangePercent })
  }

  return results.sort((a, b) => Math.abs(b.revenueChangePercent) - Math.abs(a.revenueChangePercent))
}

// ─── Promo ROI ───────────────────────────────────────────────────────────────
// Incremental GP / discount given per tracked promo

export interface PromoROI {
  promo: TrackedPromo
  promoRevenue: number
  promoQty: number
  baselineRevenue: number
  baselineQty: number
  incrementalGP: number
  discountGiven: number
  roi: number // incrementalGP / discountGiven
}

export function promoROIs(
  trackedPromos: TrackedPromo[],
  salesRecords: SalesRecord[],
): PromoROI[] {
  const results: PromoROI[] = []

  for (const promo of trackedPromos) {
    const startDate = new Date(promo.startDate)
    const endDate = new Date(promo.endDate)
    const promoDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))

    // Baseline: same number of days before promo started
    const baselineStart = new Date(startDate)
    baselineStart.setDate(baselineStart.getDate() - promoDays)

    const baselineStartStr = baselineStart.toISOString().slice(0, 10)
    const promoStartStr = promo.startDate
    const promoEndStr = promo.endDate

    const barcode = promo.barcode ?? promo.itemCode

    const baselineRecs = salesRecords.filter(r =>
      r.barcode === barcode && r.date >= baselineStartStr && r.date < promoStartStr
    )
    const promoRecs = salesRecords.filter(r =>
      r.barcode === barcode && r.date >= promoStartStr && r.date <= promoEndStr
    )

    const baselineRevenue = baselineRecs.reduce((s, r) => s + r.salesValue, 0)
    const baselineQty = baselineRecs.reduce((s, r) => s + r.qtySold, 0)
    const promoRevenue = promoRecs.reduce((s, r) => s + r.salesValue, 0)
    const promoQty = promoRecs.reduce((s, r) => s + r.qtySold, 0)
    const promoCogs = promoRecs.reduce((s, r) => s + r.cogs, 0)

    const promoGP = promoRevenue - promoCogs
    const baselineGPRate = baselineRevenue > 0
      ? (baselineRevenue - baselineRecs.reduce((s, r) => s + r.cogs, 0)) / baselineRevenue
      : 0
    const expectedGP = baselineRevenue * baselineGPRate
    const incrementalGP = promoGP - expectedGP

    const discountPerUnit = promo.normalPrice - promo.promoPrice
    const discountGiven = discountPerUnit * promoQty

    const roi = discountGiven > 0 ? incrementalGP / discountGiven : 0

    results.push({
      promo, promoRevenue, promoQty, baselineRevenue, baselineQty,
      incrementalGP, discountGiven, roi,
    })
  }

  return results.sort((a, b) => b.roi - a.roi)
}

// ─── Day-of-Week Patterns ────────────────────────────────────────────────────

export interface DayPattern {
  day: number       // 0=Sun, 6=Sat
  dayLabel: string
  avgRevenue: number
  totalRevenue: number
  count: number     // number of that weekday in range
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function dayOfWeekPatterns(
  salesRecords: SalesRecord[],
  periodDays = 90,
): DayPattern[] {
  const start = isoDateDaysAgo(periodDays)
  const today = isoToday()
  const filtered = salesRecords.filter(r => r.date >= start && r.date <= today)

  // Count how many of each weekday exist in range
  const dayCounts = new Array(7).fill(0)
  const cur = new Date(start)
  const endDate = new Date(today)
  while (cur <= endDate) {
    dayCounts[cur.getDay()]++
    cur.setDate(cur.getDate() + 1)
  }

  // Sum revenue by weekday
  const dayRevenue = new Array(7).fill(0)
  for (const r of filtered) {
    const d = new Date(r.date)
    dayRevenue[d.getDay()] += r.salesValue
  }

  return Array.from({ length: 7 }, (_, i) => ({
    day: i,
    dayLabel: DAY_NAMES[i],
    avgRevenue: dayCounts[i] > 0 ? dayRevenue[i] / dayCounts[i] : 0,
    totalRevenue: dayRevenue[i],
    count: dayCounts[i],
  }))
}
