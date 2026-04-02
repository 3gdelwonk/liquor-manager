import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/**
 * Hook that cross-references local product data with API data.
 * - getOrderCode(barcode): lookup portal order code from EAN barcode
 * - resolveCode(code): resolve any scanned/typed code to a searchable barcode
 */
export function useProductCodeLookup() {
  const products = useLiveQuery(() => db.products.toArray(), [])

  return useMemo(() => {
    const byBarcode = new Map<string, { orderCode: string; barcode: string }>()
    const codeToBarcode = new Map<string, string>()

    if (products) {
      for (const p of products) {
        const orderCode = p.itemNumber || p.invoiceCode || ''
        byBarcode.set(p.barcode, { orderCode, barcode: p.barcode })
        if (p.invoiceCode) codeToBarcode.set(p.invoiceCode.toLowerCase(), p.barcode)
        if (p.itemNumber) codeToBarcode.set(p.itemNumber.toLowerCase(), p.barcode)
      }
    }

    return {
      /** Get portal order code from EAN barcode */
      getOrderCode(barcode: string | null | undefined): string | null {
        if (!barcode) return null
        return byBarcode.get(barcode)?.orderCode || null
      },

      /** Resolve any scanned/typed code (barcode, order code, item number) to a searchable barcode */
      resolveCode(code: string): string {
        if (byBarcode.has(code)) return code
        const bc = codeToBarcode.get(code.toLowerCase())
        return bc || code
      },

      ready: !!products,
    }
  }, [products])
}
