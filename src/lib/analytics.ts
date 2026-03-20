import type { Product, StockSnapshot, SalesRecord, StockPerformance } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function salesInRange(records: SalesRecord[], barcode: string, productId: number | undefined, startDate: string, endDate: string): SalesRecord[] {
  return records.filter(r => {
    const match = r.barcode === barcode || (productId !== undefined && r.productId === productId)
    return match && r.date >= startDate && r.date <= endDate
  })
}

function isoDateDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Latest QOH ──────────────────────────────────────────────────────────────

export function getLatestQoh(snapshots: StockSnapshot[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const s of snapshots) {
    const existing = snapshots.filter(x => x.productId === s.productId)
    const latest = existing.reduce((best, x) => x.importedAt > best.importedAt ? x : best, existing[0])
    if (latest) map.set(s.productId, latest.qoh)
  }
  return map
}

// ─── ABC Classification ───────────────────────────────────────────────────────

export function classifyABC(
  products: Product[],
  salesRecords: SalesRecord[],
  periodDays = 90,
): Map<number, 'A' | 'B' | 'C' | 'D'> {
  const start = isoDateDaysAgo(periodDays)
  const end = isoToday()

  const revenues: { id: number; revenue: number }[] = products
    .filter(p => p.id !== undefined)
    .map(p => {
      const recs = salesInRange(salesRecords, p.barcode, p.id, start, end)
      const revenue = recs.reduce((s, r) => s + r.salesValue, 0)
      return { id: p.id!, revenue }
    })

  const total = revenues.reduce((s, r) => s + r.revenue, 0)
  const sorted = [...revenues].sort((a, b) => b.revenue - a.revenue)

  const result = new Map<number, 'A' | 'B' | 'C' | 'D'>()
  let cumulative = 0

  for (const item of sorted) {
    cumulative += item.revenue
    const pct = total > 0 ? cumulative / total : 0
    let cls: 'A' | 'B' | 'C' | 'D'
    if (item.revenue === 0) cls = 'D'
    else if (pct <= 0.7) cls = 'A'
    else if (pct <= 0.9) cls = 'B'
    else cls = 'C'
    result.set(item.id, cls)
  }

  return result
}

// ─── XYZ Classification ───────────────────────────────────────────────────────

export function classifyXYZ(
  products: Product[],
  salesRecords: SalesRecord[],
  periodDays = 90,
): Map<number, 'X' | 'Y' | 'Z'> {
  const start = isoDateDaysAgo(periodDays)
  const end = isoToday()
  const result = new Map<number, 'X' | 'Y' | 'Z'>()

  for (const p of products) {
    if (p.id === undefined) continue

    const recs = salesInRange(salesRecords, p.barcode, p.id, start, end)
    if (recs.length === 0) {
      result.set(p.id, 'Z')
      continue
    }

    // Build daily sales map
    const dailyMap = new Map<string, number>()
    for (const r of recs) {
      dailyMap.set(r.date, (dailyMap.get(r.date) ?? 0) + r.qtySold)
    }

    // Fill all days in range with 0 for missing days
    const days: number[] = []
    const cur = new Date(start)
    const endDate = new Date(end)
    while (cur <= endDate) {
      const k = cur.toISOString().slice(0, 10)
      days.push(dailyMap.get(k) ?? 0)
      cur.setDate(cur.getDate() + 1)
    }

    const mean = days.reduce((s, v) => s + v, 0) / days.length
    if (mean === 0) {
      result.set(p.id, 'Z')
      continue
    }

    const variance = days.reduce((s, v) => s + (v - mean) ** 2, 0) / days.length
    const stdDev = Math.sqrt(variance)
    const cov = stdDev / mean

    result.set(p.id, cov < 0.5 ? 'X' : cov <= 1.0 ? 'Y' : 'Z')
  }

  return result
}

// ─── Trend ───────────────────────────────────────────────────────────────────

export function computeTrend(
  salesRecords: SalesRecord[],
  productId: number,
  barcode: string,
): number {
  const today = isoToday()
  const w4start = isoDateDaysAgo(28)
  const w8start = isoDateDaysAgo(56)

  const recent = salesInRange(salesRecords, barcode, productId, w4start, today)
  const prev   = salesInRange(salesRecords, barcode, productId, w8start, isoDateDaysAgo(28))

  const recentQty = recent.reduce((s, r) => s + r.qtySold, 0)
  const prevQty   = prev.reduce((s, r) => s + r.qtySold, 0)

  if (prevQty === 0) return recentQty > 0 ? 100 : 0
  return ((recentQty - prevQty) / prevQty) * 100
}

// ─── Performance ──────────────────────────────────────────────────────────────

export function computePerformance(
  product: Product,
  opts: {
    snapshots: StockSnapshot[]
    salesRecords: SalesRecord[]
    abcClass: 'A' | 'B' | 'C' | 'D'
    xyzClass: 'X' | 'Y' | 'Z'
    periodDays?: number
  },
): StockPerformance {
  const { snapshots, salesRecords, abcClass, xyzClass, periodDays = 90 } = opts
  const pid = product.id!
  const barcode = product.barcode

  const start = isoDateDaysAgo(periodDays)
  const end = isoToday()
  const recs = salesInRange(salesRecords, barcode, pid, start, end)

  const totalQty = recs.reduce((s, r) => s + r.qtySold, 0)
  const totalCogs = recs.reduce((s, r) => s + r.cogs, 0)
  const totalRev  = recs.reduce((s, r) => s + r.salesValue, 0)
  const velocity = totalQty / periodDays

  // Latest QOH
  const productSnaps = snapshots.filter(s => s.productId === pid)
  const latestSnap = productSnaps.length > 0
    ? productSnaps.reduce((best, s) => s.importedAt > best.importedAt ? s : best, productSnaps[0])
    : null
  const qoh = latestSnap?.qoh ?? null

  const daysOfStock = qoh !== null && velocity > 0 ? qoh / velocity : null

  // GMROI = gross profit / average inventory value
  const grossProfit = totalRev - totalCogs
  const avgInventoryValue = qoh !== null ? qoh * product.costPrice : null
  const gmroi = avgInventoryValue !== null && avgInventoryValue > 0
    ? grossProfit / avgInventoryValue
    : null

  const trend = computeTrend(salesRecords, pid, barcode)

  // Shrinkage: if stock decreased more than sales can account for
  const shrinkage = 0 // placeholder — would need 2+ snapshots

  return { productId: pid, velocity, daysOfStock, gmroi, trend, abcClass, xyzClass, shrinkage }
}

// ─── Stock Value ──────────────────────────────────────────────────────────────

export function stockValue(
  products: Product[],
  latestQoh: Map<number, number>,
): number {
  let total = 0
  for (const p of products) {
    if (p.id === undefined) continue
    const qoh = latestQoh.get(p.id) ?? 0
    total += qoh * p.costPrice
  }
  return total
}

// ─── Category Summary ─────────────────────────────────────────────────────────

export interface CategorySummary {
  category: string
  productCount: number
  stockValue: number
  revenue30d: number
  revenuePct: number
  avgGmroi: number
}

export function categorySummary(
  products: Product[],
  snapshots: StockSnapshot[],
  salesRecords: SalesRecord[],
): CategorySummary[] {
  const latestQoh = getLatestQoh(snapshots)
  const start30 = isoDateDaysAgo(30)
  const end = isoToday()

  const byCategory = new Map<string, Product[]>()
  for (const p of products) {
    const arr = byCategory.get(p.category) ?? []
    arr.push(p)
    byCategory.set(p.category, arr)
  }

  const totalRevenue = salesRecords
    .filter(r => r.date >= start30 && r.date <= end)
    .reduce((s, r) => s + r.salesValue, 0)

  const summaries: CategorySummary[] = []

  for (const [cat, prods] of byCategory) {
    let sv = 0
    let rev30 = 0
    const gmrois: number[] = []

    for (const p of prods) {
      if (p.id === undefined) continue
      const qoh = latestQoh.get(p.id) ?? 0
      sv += qoh * p.costPrice

      const recs = salesInRange(salesRecords, p.barcode, p.id, start30, end)
      const revenue = recs.reduce((s, r) => s + r.salesValue, 0)
      const cogs    = recs.reduce((s, r) => s + r.cogs, 0)
      rev30 += revenue

      const avgInv = qoh * p.costPrice
      if (avgInv > 0) {
        gmrois.push((revenue - cogs) / avgInv)
      }
    }

    summaries.push({
      category: cat,
      productCount: prods.length,
      stockValue: sv,
      revenue30d: rev30,
      revenuePct: totalRevenue > 0 ? (rev30 / totalRevenue) * 100 : 0,
      avgGmroi: gmrois.length > 0 ? gmrois.reduce((a, b) => a + b, 0) / gmrois.length : 0,
    })
  }

  return summaries.sort((a, b) => b.stockValue - a.stockValue)
}

// ─── Replenishment Signal ─────────────────────────────────────────────────────

export function needsReplenishment(
  qoh: number | null,
  avgDailySales: number,
  leadTimeDays: number,
): boolean {
  if (qoh === null || avgDailySales <= 0) return false
  return qoh / avgDailySales < leadTimeDays
}

// ─── Snapshot Age ─────────────────────────────────────────────────────────────

export function snapshotAgeDays(snapshots: StockSnapshot[], productId: number): number | null {
  const productSnaps = snapshots.filter(s => s.productId === productId)
  if (productSnaps.length === 0) return null
  const latest = productSnaps.reduce((best, s) => s.importedAt > best.importedAt ? s : best, productSnaps[0])
  const diffMs = Date.now() - latest.importedAt.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

// ─── Opportunity Matrix ───────────────────────────────────────────────────────

export type Quadrant = 'star' | 'overstock' | 'opportunity' | 'deadweight'

export function opportunityMatrix(
  products: Product[],
  latestQoh: Map<number, number>,
  performances: Map<number, StockPerformance>,
): Map<number, Quadrant> {
  const result = new Map<number, Quadrant>()

  // Compute median velocity for threshold
  const velocities = [...performances.values()].map(p => p.velocity).filter(v => v > 0)
  velocities.sort((a, b) => a - b)
  const medianVelocity = velocities.length > 0 ? velocities[Math.floor(velocities.length / 2)] : 0

  for (const p of products) {
    if (p.id === undefined) continue
    const perf = performances.get(p.id)
    if (!perf) continue

    const qoh = latestQoh.get(p.id) ?? 0
    const maxStock = p.maxStockLevel ?? (p.minStockLevel * 2)
    const isHighVelocity = perf.velocity > medianVelocity
    const isOverstocked  = qoh > maxStock * 1.2
    const isDead         = perf.velocity === 0

    let quadrant: Quadrant
    if (isDead) {
      quadrant = 'deadweight'
    } else if (isHighVelocity && !isOverstocked) {
      quadrant = 'star'
    } else if (isHighVelocity && isOverstocked) {
      quadrant = 'opportunity'
    } else if (!isHighVelocity && isOverstocked) {
      quadrant = 'overstock'
    } else {
      quadrant = 'deadweight'
    }

    result.set(p.id, quadrant)
  }

  return result
}
