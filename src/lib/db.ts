import Dexie, { type EntityTable } from 'dexie'
import type { Product, StockSnapshot, SalesRecord, Promotion, ImportLogEntry } from './types'

export interface ImageCacheEntry {
  itemCode: string
  imageUrl: string
  fetchedAt: Date
}

class LiquorManagerDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  stockSnapshots!: EntityTable<StockSnapshot, 'id'>
  salesRecords!: EntityTable<SalesRecord, 'id'>
  promotions!: EntityTable<Promotion, 'id'>
  importLog!: EntityTable<ImportLogEntry, 'id'>
  imageCache!: EntityTable<ImageCacheEntry, 'itemCode'>

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
  }
}

export const db = new LiquorManagerDB()

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.products, db.stockSnapshots, db.salesRecords, db.promotions, db.importLog, db.imageCache], async () => {
    await db.products.clear()
    await db.stockSnapshots.clear()
    await db.salesRecords.clear()
    await db.promotions.clear()
    await db.importLog.clear()
    await db.imageCache.clear()
  })
}
