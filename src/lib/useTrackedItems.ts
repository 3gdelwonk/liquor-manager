import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/** Returns a Set of itemCodes that are actively being tracked for price changes */
export function useTrackedItemCodes(): Set<string> {
  const items = useLiveQuery(
    () => db.trackedItems.where('status').equals('active').or('status').equals('reverted').toArray(),
    []
  )
  if (!items) return new Set()
  return new Set(items.map(i => i.itemCode))
}
