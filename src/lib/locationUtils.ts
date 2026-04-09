import type { StockLocation, ItemLocation } from './jarvis'

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
