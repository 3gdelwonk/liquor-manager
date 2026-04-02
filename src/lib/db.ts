import Dexie, { type EntityTable } from 'dexie'
import type { Product, StockSnapshot, SalesRecord, Promotion, ImportLogEntry } from './types'

export interface ImageCacheEntry {
  itemCode: string
  imageUrl: string
  fetchedAt: Date
}

export interface NewsArticle {
  id?: number
  sourceId: string
  title: string
  link: string
  pubDate: string
  description: string
  tags: string[]
  fetchedAt: Date
}

export interface ABSDataPoint {
  id?: number
  period: string        // e.g. "2026-01" (YYYY-MM)
  turnover: number      // $ millions
  changePercent: number  // month-on-month %
  state: string
  fetchedAt?: Date
}

export interface TrackedItem {
  id?: number
  itemCode: string
  barcode: string | null
  description: string
  department: string
  originalPrice: number
  newPrice: number
  changeDate: string       // ISO date "2026-04-01"
  notes: string
  tags?: string[]            // user-defined tags: "Best Seller", "Slow Mover", etc.
  status: 'active' | 'reverted' | 'completed'
  currentPrice: number | null
  revertedAt: string | null
  sortOrder?: number
  createdAt: Date
}

export interface TrackedPromo {
  id?: number
  itemCode: string
  barcode: string | null
  description: string
  department: string
  normalPrice: number
  promoPrice: number
  promoUnitCost: number | null
  normalUnitCost: number
  ctnQty: number
  discountPercent: number
  marginPercent: number
  costSavingPercent: number | null
  startDate: string          // ISO date
  endDate: string            // ISO date
  daysLeft: number
  notes: string
  tags?: string[]            // user-defined tags: "Best Seller", "Slow Mover", etc.
  source?: 'system' | 'manual'   // system = from POS API (host/system promo), manual = user-entered
  status: 'active' | 'ended' | 'completed'
  sortOrder?: number
  createdAt: Date
}

class LiquorManagerDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  stockSnapshots!: EntityTable<StockSnapshot, 'id'>
  salesRecords!: EntityTable<SalesRecord, 'id'>
  promotions!: EntityTable<Promotion, 'id'>
  importLog!: EntityTable<ImportLogEntry, 'id'>
  imageCache!: EntityTable<ImageCacheEntry, 'itemCode'>
  trackedItems!: EntityTable<TrackedItem, 'id'>
  trackedPromos!: EntityTable<TrackedPromo, 'id'>
  newsArticles!: EntityTable<NewsArticle, 'id'>
  absData!: EntityTable<ABSDataPoint, 'id'>

  constructor() {
    super('LiquorManagerDB')
    this.version(1).stores({
      products:       '++id, barcode, invoiceCode, category, active',
      stockSnapshots: '++id, [productId+importedAt], barcode, importBatchId',
      salesRecords:   '++id, barcode, date, [barcode+date], productId, importBatchId',
      promotions:     '++id, productId, startDate, endDate',
      importLog:      '++id, importedAt, type',
    })
    this.version(2).stores({
      products:       '++id, barcode, invoiceCode, category, active',
      stockSnapshots: '++id, [productId+importedAt], barcode, importBatchId',
      salesRecords:   '++id, barcode, date, [barcode+date], productId, importBatchId',
      promotions:     '++id, productId, startDate, endDate',
      importLog:      '++id, importedAt, type',
      imageCache:     'itemCode, fetchedAt',
    })
    this.version(3).stores({
      products:       '++id, barcode, invoiceCode, category, active',
      stockSnapshots: '++id, [productId+importedAt], barcode, importBatchId',
      salesRecords:   '++id, barcode, date, [barcode+date], productId, importBatchId',
      promotions:     '++id, productId, startDate, endDate',
      importLog:      '++id, importedAt, type',
      imageCache:     'itemCode, fetchedAt',
      trackedItems:   '++id, itemCode, status, changeDate',
    })
    this.version(4).stores({
      products:       '++id, barcode, invoiceCode, category, active',
      stockSnapshots: '++id, [productId+importedAt], barcode, importBatchId',
      salesRecords:   '++id, barcode, date, [barcode+date], productId, importBatchId',
      promotions:     '++id, productId, startDate, endDate',
      importLog:      '++id, importedAt, type',
      imageCache:     'itemCode, fetchedAt',
      trackedItems:   '++id, itemCode, status, changeDate',
      trackedPromos:  '++id, itemCode, status, startDate, endDate',
    })
    this.version(5).stores({
      products:       '++id, barcode, invoiceCode, category, active',
      stockSnapshots: '++id, [productId+importedAt], barcode, importBatchId',
      salesRecords:   '++id, barcode, date, [barcode+date], productId, importBatchId',
      promotions:     '++id, productId, startDate, endDate',
      importLog:      '++id, importedAt, type',
      imageCache:     'itemCode, fetchedAt',
      trackedItems:   '++id, itemCode, status, changeDate',
      trackedPromos:  '++id, itemCode, status, startDate, endDate',
      newsArticles:   '++id, sourceId, link, pubDate',
      absData:        '++id, period',
    })
  }
}

export const db = new LiquorManagerDB()

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.products, db.stockSnapshots, db.salesRecords, db.promotions, db.importLog, db.imageCache, db.trackedItems, db.trackedPromos, db.newsArticles, db.absData], async () => {
    await db.products.clear()
    await db.stockSnapshots.clear()
    await db.salesRecords.clear()
    await db.promotions.clear()
    await db.importLog.clear()
    await db.imageCache.clear()
    await db.trackedItems.clear()
    await db.trackedPromos.clear()
    await db.newsArticles.clear()
    await db.absData.clear()
  })
}
