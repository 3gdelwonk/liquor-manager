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

// ── Tolerant field extractors ────────────────────────────────────────────────
// JARVISmart endpoints use inconsistent shapes — same conceptual field can be
// `typeId`/`type`/`levelId`, returned as number or string. These helpers try
// every plausible name and coerce when needed.
function pickNumber(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && !isNaN(v)) return v
    if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v)
  }
  return null
}
function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}

const TYPE_KEYS = ['typeId', 'type', 'typeID', 'levelId', 'level', 'locationTypeId', 'locationType']
const NAME_KEYS = ['name', 'locationName', 'displayName', 'label', 'title']
const CODE_KEYS = ['shortCode', 'code', 'short', 'shortcode', 'locationCode']
const PARENT_KEYS = ['parentId', 'parent', 'parentID', 'parent_id', 'parentLocationId']
const ID_KEYS = ['locationId', 'id', 'locationID', 'location_id']
const PATH_KEYS = ['path', 'fullPath', 'breadcrumb', 'hierarchy']

/**
 * Build a 4-level breadcrumb for an item's assigned location.
 *
 * Tolerant of varied server response shapes — reads typeId/name/parentId from
 * any of the plausible field names. Seeds the slot for `loc.typeId` from the
 * ItemLocation itself, then walks ancestors via the loaded flat list. Falls
 * back to splitting `path` positionally if nothing populates.
 */
export function buildItemBreadcrumb(
  loc: ItemLocation,
  flat: FlatLocation[]
): Record<LevelKey, BreadcrumbCell> {
  const empty: BreadcrumbCell = { id: null, name: null, shortCode: null }
  const result: Record<LevelKey, BreadcrumbCell> = {
    4: { ...empty }, 1: { ...empty }, 2: { ...empty }, 3: { ...empty },
  }

  const o = loc as unknown as Record<string, unknown>
  const seedTypeId = pickNumber(o, TYPE_KEYS)
  const seedName = pickString(o, NAME_KEYS)
  const seedCode = pickString(o, CODE_KEYS)
  const seedId = pickNumber(o, ID_KEYS)
  const seedPath = pickString(o, PATH_KEYS)

  const byId = new Map(flat.map(l => [l.id, l]))

  // The /locations/item/:code endpoint only returns the leaf — no parentId,
  // no ancestor info. To build the full breadcrumb we need to look the leaf
  // up in `flat` (which has the full tree from /api/pos/locations) and walk
  // its parent chain from there.
  let walkFrom: FlatLocation | null = null

  if (seedId != null) {
    walkFrom = byId.get(seedId) ?? null
  }

  if (walkFrom) {
    // Found in tree — seed from the tree entry (authoritative)
    if (walkFrom.typeId === 1 || walkFrom.typeId === 2 || walkFrom.typeId === 3 || walkFrom.typeId === 4) {
      result[walkFrom.typeId as LevelKey] = {
        id: walkFrom.id,
        name: walkFrom.name,
        shortCode: walkFrom.shortCode,
      }
    }
    // Walk ancestors
    let parentId: number | null = walkFrom.parentId
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
  } else {
    // Leaf not in tree — seed from ItemLocation directly (degraded mode)
    if (seedTypeId === 1 || seedTypeId === 2 || seedTypeId === 3 || seedTypeId === 4) {
      result[seedTypeId as LevelKey] = {
        id: seedId,
        name: seedName,
        shortCode: seedCode,
      }
    }
  }

  // Fallback: split server `path` positionally if nothing populated
  const populated = (Object.values(result) as BreadcrumbCell[]).some(c => c.name)
  if (!populated && seedPath) {
    const parts = seedPath.split('>').map(s => s.trim()).filter(Boolean)
    const levelsTopDown: LevelKey[] = [4, 1, 2, 3]
    parts.slice(0, 4).forEach((p, i) => {
      const k = levelsTopDown[i]
      result[k] = { id: null, name: p, shortCode: null }
    })
  }

  // Final last-resort: if we STILL have nothing, drop whatever name we found
  // into the deepest plausible slot so the user sees the location at all.
  const populatedFinal = (Object.values(result) as BreadcrumbCell[]).some(c => c.name)
  if (!populatedFinal && seedName) {
    result[3] = { id: seedId, name: seedName, shortCode: seedCode }
  }

  return result
}
