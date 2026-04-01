import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/** Returns a Set of itemCodes that are actively being tracked (price changes or promos) */
export function useTrackedItemCodes(): Set<string> {
  const priceItems = useLiveQuery(
    () => db.trackedItems.where('status').equals('active').or('status').equals('reverted').toArray(),
    []
  )
  const promoItems = useLiveQuery(
    () => db.trackedPromos.where('status').equals('active').toArray(),
    []
  )
  const codes = new Set<string>()
  if (priceItems) for (const i of priceItems) codes.add(i.itemCode)
  if (promoItems) for (const i of promoItems) codes.add(i.itemCode)
  return codes
}
