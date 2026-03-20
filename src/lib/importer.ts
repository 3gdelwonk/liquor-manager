/**
 * importer.ts — Smart Retail + JARVISmart parsers for Liquor Manager
 *
 * Handles 3 import types:
 *  1. Item Maintenance Report  → creates/updates Product records (liquor dept only)
 *  2. Item Stock Report        → creates StockSnapshot records
 *  3. JARVISmart Sales Report  → creates/updates SalesRecord records
 */

import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { db } from './db'
import { LIQUOR_DEPT_TERMS } from './constants'
import type { Product, StockSnapshot, SalesRecord, LiquorCategory } from './types'

// ─── File → rows ─────────────────────────────────────────────────────────────

type Row = Record<string, string>

function normalizeHeader(h: string): string {
  return h.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function xlsxToRows(file: File): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const actualRef = XLSX.utils.encode_range(
          XLSX.utils.decode_range(
            Object.keys(sheet)
              .filter((k) => !k.startsWith('!'))
              .reduce((ref, cell) => {
                const r = XLSX.utils.decode_cell(cell)
                const cur = ref ? XLSX.utils.decode_range(ref) : { s: r, e: r }
                cur.s.r = Math.min(cur.s.r, r.r)
                cur.s.c = Math.min(cur.s.c, r.c)
                cur.e.r = Math.max(cur.e.r, r.r)
                cur.e.c = Math.max(cur.e.c, r.c)
                return XLSX.utils.encode_range(cur)
              }, sheet['!ref'] ?? 'A1'),
          ),
        )
        sheet['!ref'] = actualRef
        const raw = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false })
        const rows = raw.map((row) => {
          const normalised: Row = {}
          for (const [k, v] of Object.entries(row)) {
            normalised[normalizeHeader(k)] = v
          }
          return normalised
        })
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

function csvToRows(file: File): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      let text = (e.target?.result as string) ?? ''
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      const delimiter = text.includes('\t') ? '\t' : ','
      const result = Papa.parse<Row>(text, {
        header: true,
        delimiter,
        skipEmptyLines: true,
        transformHeader: (h) => normalizeHeader(h),
        transform: (v) => v.trim(),
      })
      if (result.errors.length && result.data.length === 0) {
        reject(new Error(result.errors[0]!.message))
      } else {
        resolve(result.data)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'utf-8')
  })
}

async function fileToRows(file: File): Promise<Row[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'xlsx' || ext === 'xls' ? xlsxToRows(file) : csvToRows(file)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findCol(row: Row, candidates: string[]): string {
  const keys = Object.keys(row)
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase().trim() === c.toLowerCase())
    if (found) return found
  }
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase().includes(c.toLowerCase()))
    if (found) return found
  }
  return ''
}

function getVal(row: Row, candidates: string[]): string {
  const key = findCol(row, candidates)
  return key ? (row[key] ?? '').trim() : ''
}

function parsePrice(s: string): number {
  return parseFloat(s.replace(/[^0-9.-]/g, '')) || 0
}

const ACTIVE_ACCEPTED = new Set(['yes', 'y', '1', 'true', 'active'])
function isActive(raw: string): boolean {
  const v = raw.toLowerCase().trim()
  return v === '' || ACTIVE_ACCEPTED.has(v)
}

function isLiquorDept(raw: string): boolean {
  const v = raw.toLowerCase().trim()
  return v === '' || LIQUOR_DEPT_TERMS.some((t) => v.includes(t))
}

function mapLiquorCategory(deptName: string): LiquorCategory {
  const v = deptName.toLowerCase()
  if (v.includes('beer') || v.includes('craft')) return 'beer'
  if (v.includes('wine')) return 'wine'
  if (v.includes('spirit') || v.includes('whisky') || v.includes('whiskey') || v.includes('bourbon') || v.includes('vodka') || v.includes('gin') || v.includes('rum')) return 'spirits'
  if (v.includes('cider')) return 'cider'
  if (v.includes('rtd') || v.includes('premix') || v.includes('ready to drink')) return 'rtd'
  if (v.includes('non') || v.includes('zero') || v.includes('alcohol free')) return 'non_alc'
  return 'other'
}

function normalizeColName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function normalizeDate(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30))
    epoch.setUTCDate(epoch.getUTCDate() + raw)
    return epoch.toISOString().split('T')[0]!
  }
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch
    const year = y!.length === 2 ? `20${y}` : y
    return `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  }
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0]!
  return null
}

function parseNum(v: string | number | undefined): number {
  if (v === undefined || v === null || v === '') return 0
  return parseFloat(String(v).replace(/[,$]/g, '')) || 0
}

// ─── Item Maintenance ─────────────────────────────────────────────────────────

export interface MaintenanceResult {
  updated: number
  newProducts: number
  skipped: number
  anomalies: string[]
  lastImportedAt: Date
  detectedColumns: string[]
}

export async function parseItemMaintenance(file: File): Promise<MaintenanceResult> {
  const rows = await fileToRows(file)
  const result: MaintenanceResult = {
    updated: 0, newProducts: 0, skipped: 0, anomalies: [], lastImportedAt: new Date(), detectedColumns: [],
  }

  if (rows.length > 0) {
    const firstRow = rows[0]!
    const expectedCols: Array<[string, string[]]> = [
      ['Active',          ['Active', 'active']],
      ['Department Name', ['Department Name', 'department name', 'dept name']],
      ['Barcode',         ['Barcode', 'barcode', 'EAN']],
      ['Description',     ['Description', 'description']],
      ['Order Code',      ['Order Code', 'order code', 'order_code', 'item number']],
      ['Normal Sell',     ['Normal Sell', 'normal sell', 'sell price']],
      ['Normal Cost',     ['Normal Cost', 'normal cost', 'cost price']],
    ]
    for (const [label, candidates] of expectedCols) {
      const found = findCol(firstRow, candidates)
      result.detectedColumns.push(found ? `✓ ${label} → "${found}"` : `✗ ${label} (not found)`)
    }
  }

  const byBarcode = new Map<string, Row>()

  for (const row of rows) {
    const active = getVal(row, ['Active', 'active'])
    const deptName = getVal(row, ['Department Name', 'department name', 'dept name'])
    if (!isActive(active)) { result.skipped++; continue }
    if (!isLiquorDept(deptName)) { result.skipped++; continue }
    const barcode = getVal(row, ['Barcode', 'barcode', 'EAN'])
    if (!barcode || barcode === 'NH') { result.skipped++; continue }
    // Keep latest row per barcode (last writer wins)
    byBarcode.set(barcode, row)
  }

  for (const [barcode, row] of byBarcode) {
    const deptName = getVal(row, ['Department Name', 'department name', 'dept name'])
    const sellPriceRaw = getVal(row, ['Normal Sell', 'normal sell', 'sell price'])
    const costPriceRaw = getVal(row, ['Normal Cost', 'normal cost', 'cost price'])
    const sellPrice = parsePrice(sellPriceRaw)
    const costPrice = parsePrice(costPriceRaw)

    const ANOMALY_THRESHOLD = 200
    if (costPrice > ANOMALY_THRESHOLD) {
      const name = getVal(row, ['Description', 'description'])
      result.anomalies.push(`Cost $${costPrice.toFixed(2)} for "${name}" (barcode ${barcode}) — exceeds $${ANOMALY_THRESHOLD} threshold, price NOT updated`)
      result.skipped++
      continue
    }

    const existing = await db.products.where('barcode').equals(barcode).first()

    if (existing) {
      await db.products.update(existing.id!, {
        sellPrice: sellPrice > 0 ? sellPrice : existing.sellPrice,
        costPrice: costPrice > 0 ? costPrice : existing.costPrice,
        active: true,
        updatedAt: new Date(),
      })
      result.updated++
    } else {
      const name = getVal(row, ['Description', 'description'])
      const orderCode = getVal(row, ['Order Code', 'order code', 'order_code', 'item number'])
      const itemNumber = orderCode ? parseInt(orderCode, 10).toString() : ''
      const invoiceCode = itemNumber ? itemNumber.padStart(8, '0') : barcode
      const category = mapLiquorCategory(deptName)

      const now = new Date()
      const newProduct: Omit<Product, 'id'> = {
        barcode,
        invoiceCode,
        itemNumber,
        name,
        smartRetailName: name,
        category,
        active: true,
        minStockLevel: 0,
        sellPrice,
        costPrice,
        isGstBearing: false,
        createdAt: now,
        updatedAt: now,
      }
      try {
        await db.products.add(newProduct as Product)
        result.newProducts++
        result.anomalies.push(`Auto-created: "${name}" (${category}) — review min/max stock levels`)
      } catch {
        result.anomalies.push(`Skipped: "${name}" (barcode ${barcode}) — duplicate or constraint error`)
      }
    }
  }

  // Save import log
  await db.importLog.add({
    importedAt: result.lastImportedAt,
    type: 'item_maintenance',
    fileName: file.name,
    recordCount: result.updated + result.newProducts,
    anomalyCount: result.anomalies.length,
  })

  return result
}

// ─── Stock Report ─────────────────────────────────────────────────────────────

export interface StockResult {
  snapshots: number
  matched: number
  unmatched: number
  lastImportedAt: Date
}

export async function parseStockReport(file: File): Promise<StockResult> {
  const rows = await fileToRows(file)
  const result: StockResult = { snapshots: 0, matched: 0, unmatched: 0, lastImportedAt: new Date() }

  const importBatchId = `stock-${Date.now()}`
  const importedAt = new Date()

  for (const row of rows) {
    const barcode = getVal(row, ['Barcode', 'barcode', 'EAN'])
    if (!barcode || barcode === 'NH') continue
    const qohRaw = getVal(row, ['QOH', 'qoh', 'Qty On Hand', 'qty on hand', 'Quantity On Hand'])
    const qoh = parseInt(qohRaw, 10)
    if (isNaN(qoh)) continue

    const product = await db.products.where('barcode').equals(barcode).first()
    if (product) {
      const snap: Omit<StockSnapshot, 'id'> = {
        productId: product.id!,
        barcode,
        qoh,
        importedAt,
        source: 'item_stock_report',
        importBatchId,
      }
      await db.stockSnapshots.add(snap as StockSnapshot)
      result.matched++
    } else {
      result.unmatched++
    }
    result.snapshots++
  }

  // Cleanup old snapshots (keep 2 most recent per product)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const allSnaps = await db.stockSnapshots.toArray()
  const byProduct = new Map<number, typeof allSnaps>()
  for (const s of allSnaps) {
    const arr = byProduct.get(s.productId) ?? []
    arr.push(s)
    byProduct.set(s.productId, arr)
  }
  const toDelete: number[] = []
  for (const snaps of byProduct.values()) {
    const sorted = snaps.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
    for (const s of sorted.slice(2)) {
      if (new Date(s.importedAt) < cutoff) toDelete.push(s.id!)
    }
  }
  if (toDelete.length) await db.stockSnapshots.bulkDelete(toDelete)

  await db.importLog.add({
    importedAt,
    type: 'stock_report',
    fileName: file.name,
    recordCount: result.matched,
    anomalyCount: result.unmatched,
  })

  return result
}

// ─── Sales Report ─────────────────────────────────────────────────────────────

export interface SalesResult {
  matched: number
  unmatched: number
  duplicateUpdated: number
  newRecords: number
  anomalies: string[]
  dateRange: { from: string; to: string } | null
  lastImportedAt: Date
}

const SALES_COLUMN_MAP: Record<string, string[]> = {
  barcode:    ['plu', 'pluno', 'barcode', 'item_no', 'sku', 'item_number', 'code'],
  date:       ['date', 'sale_date', 'trans_date', 'period', 'trade_date', 'business_date'],
  qtySold:    ['qty_sold', 'units_sold', 'sales_qty', 'quantity', 'qty', 'sold_qty', 'units'],
  salesValue: ['sales_value', 'total_sales', 'revenue', 'net_sales', 'sales_ex_gst', 'sales_inc_gst', 'amount'],
  cogs:       ['cogs', 'cost', 'cost_of_goods', 'total_cost', 'cost_value', 'cost_amount'],
  department: ['department', 'dept', 'dept_code', 'section', 'section_code'],
}

function buildColumnIndex(headers: string[]): Map<string, string> {
  const normalized = headers.map(normalizeColName)
  const index = new Map<string, string>()
  for (const [canonical, aliases] of Object.entries(SALES_COLUMN_MAP)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias)
      if (idx !== -1) {
        index.set(canonical, headers[idx]!)
        break
      }
    }
  }
  return index
}

export async function parseSalesReport(file: File): Promise<SalesResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  let rows: Record<string, unknown>[]

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer()
    const { read, utils } = await import('xlsx')
    const wb = read(buf, { type: 'array', cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = utils.sheet_to_json<Record<string, unknown>>(ws!, { defval: '', raw: true })
  } else {
    const text = await file.text()
    const { read, utils } = await import('xlsx')
    const wb = read(text, { type: 'string', cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = utils.sheet_to_json<Record<string, unknown>>(ws!, { defval: '', raw: false })
  }

  if (!rows.length) throw new Error('File is empty or has no data rows')

  const headers = Object.keys(rows[0]!)
  const colIndex = buildColumnIndex(headers)

  const barcodeCol = colIndex.get('barcode')
  const dateCol = colIndex.get('date')
  const qtyCol = colIndex.get('qtySold')

  if (!barcodeCol || !dateCol || !qtyCol) {
    const missing = ['barcode', 'date', 'qtySold'].filter((c) => !colIndex.get(c))
    throw new Error(`Cannot detect required columns: ${missing.join(', ')}`)
  }

  const salesValueCol = colIndex.get('salesValue')
  const cogsCol = colIndex.get('cogs')
  const deptCol = colIndex.get('department')

  const allProducts = await db.products.toArray()
  const barcodeToProductId = new Map<string, number>()
  for (const p of allProducts) {
    if (p.barcode) barcodeToProductId.set(p.barcode.trim(), p.id!)
    if (p.invoiceCode) barcodeToProductId.set(p.invoiceCode.trim(), p.id!)
    if (p.itemNumber) barcodeToProductId.set(p.itemNumber.trim(), p.id!)
  }

  interface DailyEntry {
    barcode: string; date: string; qtySold: number
    salesValue: number; cogs: number; department?: string; productId?: number
  }

  const dailyMap = new Map<string, DailyEntry>()
  const anomalies: string[] = []
  let skippedRows = 0

  for (const row of rows) {
    const rawBarcode = String(row[barcodeCol] ?? '').trim()
    const rawDate = row[dateCol]
    const rawQty = row[qtyCol]
    if (!rawBarcode) { skippedRows++; continue }
    const date = normalizeDate(rawDate as string | number | undefined)
    if (!date) { anomalies.push(`Row skipped — invalid date: "${rawDate}" for barcode ${rawBarcode}`); skippedRows++; continue }
    const qty = parseNum(rawQty as string | number | undefined)
    if (qty === 0) continue
    const key = `${rawBarcode}::${date}`
    const existing = dailyMap.get(key)
    const salesValue = salesValueCol ? parseNum(row[salesValueCol] as string | number | undefined) : 0
    const cogs = cogsCol ? parseNum(row[cogsCol] as string | number | undefined) : 0
    const department = deptCol ? String(row[deptCol] ?? '').trim() : undefined
    if (existing) {
      existing.qtySold += qty; existing.salesValue += salesValue; existing.cogs += cogs
    } else {
      dailyMap.set(key, { barcode: rawBarcode, date, qtySold: qty, salesValue, cogs, department: department || undefined, productId: barcodeToProductId.get(rawBarcode) })
    }
  }

  if (skippedRows > 5) anomalies.push(`${skippedRows} rows skipped due to missing barcode or invalid date`)

  const dailyRecords = [...dailyMap.values()]
  if (dailyRecords.length === 0) throw new Error('No valid sales records found in file')

  const dates = dailyRecords.map((r) => r.date).sort()
  const dateRange = { from: dates[0]!, to: dates[dates.length - 1]! }

  const matched = dailyRecords.filter((r) => r.productId !== undefined).length
  const unmatched = dailyRecords.length - matched
  if (unmatched > 0) {
    const unmatchedBarcodes = [...new Set(dailyRecords.filter((r) => r.productId === undefined).map((r) => r.barcode))].slice(0, 5)
    anomalies.push(`${unmatched} records have unmatched barcodes (e.g. ${unmatchedBarcodes.join(', ')})`)
  }

  const importedBarcodes = [...new Set(dailyRecords.map((r) => r.barcode))]
  const existingRecords = await db.salesRecords.where('barcode').anyOf(importedBarcodes).toArray()
  const existingMap = new Map(existingRecords.map((r) => [`${r.barcode}::${r.date}`, r]))

  const importBatchId = `jarvis-${Date.now()}`
  const importedAt = new Date()
  const toAdd: SalesRecord[] = []
  let duplicateUpdated = 0

  for (const record of dailyRecords) {
    const key = `${record.barcode}::${record.date}`
    const ex = existingMap.get(key)
    if (ex) {
      await db.salesRecords.update(ex.id!, { qtySold: record.qtySold, salesValue: record.salesValue, cogs: record.cogs, productId: record.productId, importBatchId, importedAt })
      duplicateUpdated++
    } else {
      toAdd.push({ ...record, importBatchId, importedAt })
    }
  }
  if (toAdd.length > 0) await db.salesRecords.bulkAdd(toAdd)

  await db.importLog.add({
    importedAt,
    type: 'sales',
    fileName: file.name,
    recordCount: dailyRecords.length,
    anomalyCount: anomalies.length,
  })

  return { matched, unmatched, duplicateUpdated, newRecords: toAdd.length, anomalies, dateRange, lastImportedAt: importedAt }
}
