import type { StockLocation, ItemLocation } from './jarvis'

type LevelKey = 1 | 2 | 3 | 4

/** Build a flat list from hierarchical locations for dropdowns */
export function flattenLocations(locations: StockLocation[], parentPath = ''): FlatLocation[] {
  const result: FlatLocation[] = []
  for (const loc of locations) {
    const path = parentPath ? `${parentPath} > ${loc.name}` : loc.name
    result.push({ id: loc.id, name: loc.name, shortCode: loc.shortCode, typeId: loc.typeId, typeName: loc.typeName, path, parentId: loc.parentId })
    if (loc.children?.length) {
      result.push(...flattenLocations(loc.children, path))
    }
  }
  return result
}

export interface FlatLocation {
  id: number
  name: string
  shortCode: string
  typeId: number
  typeName?: string
  path: string
  parentId: number | null
}

/** Format an ItemLocation for display */
export function formatItemLocation(loc: ItemLocation): string {
  if (loc.path) return loc.path
  return loc.name || loc.shortCode || `Location #${loc.locationId}`
}

/** Build tree from flat list using parentId */
export function buildLocationTree(flat: StockLocation[]): StockLocation[] {
  const map = new Map<number, StockLocation>()
  const roots: StockLocation[] = []

  // Index all nodes
  for (const loc of flat) {
    map.set(loc.id, { ...loc, children: [] })
  }

  // Build parent-child relationships
  for (const loc of flat) {
    const node = map.get(loc.id)!
    if (loc.parentId && map.has(loc.parentId)) {
      map.get(loc.parentId)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/** Get the type label for a typeId */
export const TYPE_LABELS: Record<number, string> = {
  1: 'Aisle',
  2: 'Bay',
  3: 'Row',
  4: 'Zone',
}

/** Display labels for user-facing UI */
export const TYPE_DISPLAY_LABELS: Record<number, string> = {
  1: 'Aisle',
  2: 'Bay',
  3: 'Row',
  4: 'Zone',
}

export function getTypeLabel(typeId: number, typeName?: string): string {
  return typeName || TYPE_LABELS[typeId] || 'Location'
}

export function getDisplayLabel(typeId: number): string {
  return TYPE_DISPLAY_LABELS[typeId] || 'Location'
}

/**
 * Walk the parent chain of a location and return the entry at each level
 * (Zone=4, Aisle=1, Bay=2, Row=3). Levels not present in the chain are null.
 * Used to pre-fill cascade pickers when navigating an existing tree.
 */
export function parseLocationHierarchy(
  locationId: number,
  flat: FlatLocation[]
): Record<LevelKey, FlatLocation | null> {
  const result: Record<LevelKey, FlatLocation | null> = { 4: null, 1: null, 2: null, 3: null }
  const byId = new Map(flat.map(l => [l.id, l]))
  let current: FlatLocation | undefined = byId.get(locationId)
  let hops = 0
  while (current && hops < 10) {
    if (current.typeId === 1 || current.typeId === 2 || current.typeId === 3 || current.typeId === 4) {
      result[current.typeId as LevelKey] = current
    }
    if (current.parentId == null) break
    current = byId.get(current.parentId)
    hops++
  }
  return result
}

export interface BreadcrumbCell {
  id: number | null
  name: string | null
  shortCode: string | null
}

/**
 * Build a 4-level breadcrumb for an item's assigned location, starting from
 * the ItemLocation itself (which always has its own typeId/name/parentId from
 * the assignment) and walking up the parent chain via the loaded flat list.
 *
 * Critically robust against the case where `flat` doesn't contain the leaf —
 * we always populate the slot for `loc.typeId` directly from the ItemLocation,
 * so the user always sees at least the level the item is actually assigned at.
 */
export function buildItemBreadcrumb(
  loc: ItemLocation,
  flat: FlatLocation[]
): Record<LevelKey, BreadcrumbCell> {
  const empty: BreadcrumbCell = { id: null, name: null, shortCode: null }
  const result: Record<LevelKey, BreadcrumbCell> = {
    4: { ...empty }, 1: { ...empty }, 2: { ...empty }, 3: { ...empty },
  }

  // Seed from the ItemLocation itself (its own typeId)
  if (loc.typeId === 1 || loc.typeId === 2 || loc.typeId === 3 || loc.typeId === 4) {
    result[loc.typeId as LevelKey] = {
      id: loc.locationId,
      name: loc.name || null,
      shortCode: loc.shortCode || null,
    }
  }

  // Walk up via parentId, looking up each ancestor in the flat list
  const byId = new Map(flat.map(l => [l.id, l]))
  let parentId: number | null = loc.parentId ?? null
  let hops = 0
  while (parentId != null && hops < 10) {
    const parent = byId.get(parentId)
    if (!parent) break
    if (parent.typeId === 1 || parent.typeId === 2 || parent.typeId === 3 || parent.typeId === 4) {
      result[parent.typeId as LevelKey] = {
        id: parent.id,
        name: parent.name,
        shortCode: parent.shortCode,
      }
    }
    parentId = parent.parentId
    hops++
  }

  // Last-resort fallback: if we still have nothing populated and the server
  // sent a `path` like "ZONE > AISLE > BAY > ROW", split it positionally so
  // the user at least sees something rather than four blank cells.
  const populated = (Object.values(result) as BreadcrumbCell[]).some(c => c.name)
  if (!populated && loc.path && typeof loc.path === 'string') {
    const parts = loc.path.split('>').map(s => s.trim()).filter(Boolean)
    // Order top-down: Zone, Aisle, Bay, Row
    const levelsTopDown: LevelKey[] = [4, 1, 2, 3]
    parts.slice(0, 4).forEach((p, i) => {
      const k = levelsTopDown[i]
      result[k] = { id: null, name: p, shortCode: null }
    })
  }

  return result
}
