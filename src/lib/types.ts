export type LiquorCategory = 'beer' | 'wine' | 'spirits' | 'cider' | 'rtd' | 'non_alc' | 'other'

export interface Product {
  id?: number
  barcode: string
  invoiceCode: string
  itemNumber: string
  name: string
  smartRetailName?: string
  category: LiquorCategory
  active: boolean
  minStockLevel: number
  maxStockLevel?: number
  sellPrice: number
  costPrice: number
  isGstBearing: boolean
  abv?: number
  bottleSize?: number
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface StockSnapshot {
  id?: number
  productId: number
  barcode: string
  qoh: number
  importedAt: Date
  source: 'item_maintenance' | 'item_stock_report'
  importBatchId: string
}

export interface SalesRecord {
  id?: number
  productId?: number
  barcode: string
  date: string
  qtySold: number
  salesValue: number
  cogs: number
  department?: string
  importBatchId: string
  importedAt: Date
}

export interface Promotion {
  id?: number
  productId: number
  productName: string
  barcode: string
  startDate: string
  endDate: string
  promoPrice: number
  normalPrice: number
  promoType: 'price_reduction' | 'multibuy' | 'special'
  multibuyQty?: number
  multibuyPrice?: number
  notes?: string
  createdAt: Date
}

export interface ImportLogEntry {
  id?: number
  importedAt: Date
  type: 'item_maintenance' | 'stock_report' | 'sales'
  fileName: string
  recordCount: number
  anomalyCount: number
}

export interface StockPerformance {
  productId: number
  velocity: number
  daysOfStock: number | null
  gmroi: number | null
  trend: number
  abcClass: 'A' | 'B' | 'C' | 'D'
  xyzClass: 'X' | 'Y' | 'Z'
  shrinkage: number
}
