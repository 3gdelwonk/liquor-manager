// ═══════════════════════════════════════════════
// Product Image Service
// Fetches product images via Serper.dev (Google Images), caches in IndexedDB
// ═══════════════════════════════════════════════

import { db } from './db'

// Default Serper API key (free 2,500 queries)
const DEFAULT_SERPER_KEY = '189a40fd7365625bd484571377c563e96c88820c'

// POS description abbreviation map for better search queries
const ABBREV: Record<string, string> = {
  'VLY': 'VALLEY', 'MARLB': 'MARLBOROUGH', 'SAV': 'SAUVIGNON', 'BLNC': 'BLANC',
  'CAB': 'CABERNET', 'SAUV': 'SAUVIGNON', 'SHZ': 'SHIRAZ', 'CHARD': 'CHARDONNAY',
  'P/NOIR': 'PINOT NOIR', 'P/GRIG': 'PINOT GRIGIO', 'MOSCATO': 'MOSCATO',
  'MERLOT': 'MERLOT', 'MALBEC': 'MALBEC', 'RSLING': 'RIESLING',
  'LGR': 'LAGER', 'BTL': '', 'CAN': '', 'STB': 'STUBBIES',
  'S/BLC': 'SAUVIGNON BLANC', 'DBL': 'DOUBLE', 'SMKD': 'SMOKED',
  'ORG': 'ORIGINAL', 'PREM': 'PREMIUM', 'LIQ': 'LIQUEUR',
  'GRT': 'GREAT', 'NTH': 'NORTHERN', 'RES': 'RESERVE',
  'WHISKY': 'WHISKY', 'BOURBON': 'BOURBON',
  'RSV': 'RESERVE', 'CIDER': 'CIDER',
}

function cleanDescription(desc: string): string {
  // Remove size info (750ML, 375ML, 4*200ML, 4X200ML, etc.)
  let clean = desc.replace(/\d+[*xX]?\d*\s*ML/gi, '').replace(/\d+\s*L\b/gi, '')
  // Remove pack counts (4S, 6PK, 10PK, 4X, 2PK, etc.)
  clean = clean.replace(/\b\d+\s*(S|PK|X)\b/gi, '')
  // Remove trailing weight/size patterns
  clean = clean.replace(/\b\d+\s*(GM|KG|G)\b/gi, '')
  // Expand abbreviations
  clean = clean.split(/[\s/]+/).map(word => {
    const upper = word.toUpperCase().replace(/[^A-Z/]/g, '')
    return ABBREV[upper] ?? word
  }).filter(w => w.length > 0).join(' ')
  // Remove extra whitespace and stray punctuation
  return clean.replace(/\s+/g, ' ').replace(/[*#&]/g, '').trim()
}

function buildSearchQuery(description: string, department: string, barcode?: string | null): string {
  // If we have a barcode, try that first — very specific match
  if (barcode) {
    return `${barcode} product`
  }
  const cleaned = cleanDescription(description)
  const deptHint = department === 'BEER' ? 'beer'
    : department === 'WINE' ? 'wine bottle'
    : department === 'SPIRITS' ? 'spirits bottle'
    : department === 'LIQUEURS' ? 'liqueur bottle'
    : 'liquor'
  return `${cleaned} ${deptHint}`
}

// Serper.dev API — user sets key in settings or we use default
function getSerperApiKey(): string {
  return localStorage.getItem('liquor-manager-serper-api-key') || (import.meta.env.VITE_SERPER_API_KEY as string) || DEFAULT_SERPER_KEY
}

export function isImageSearchConfigured(): boolean {
  return !!getSerperApiKey()
}

interface SerperImageResult {
  title: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  source: string
  domain: string
}

interface SerperResponse {
  images?: SerperImageResult[]
  message?: string
}

async function serperImageSearch(query: string): Promise<string | null | 'error'> {
  const apiKey = getSerperApiKey()
  if (!apiKey) return 'error'

  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5 }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.warn(`[ImageSearch] Serper API error ${res.status}: ${text.slice(0, 200)}`)
      return 'error'
    }

    const data: SerperResponse = await res.json()
    if (!data.images || data.images.length === 0) return null

    // Pick the first image that looks like a product photo (not a tiny icon)
    const img = data.images.find(i => i.imageWidth >= 100 && i.imageHeight >= 100)
    return img?.imageUrl ?? data.images[0]?.imageUrl ?? null
  } catch (err) {
    console.warn('[ImageSearch] Fetch error:', err)
    return 'error'
  }
}

// ── Cache layer (IndexedDB via Dexie) ──────────────────────────────────────

export async function getCachedImageUrl(itemCode: string): Promise<string | null> {
  const entry = await db.imageCache.get(itemCode)
  return entry?.imageUrl ?? null
}

export async function fetchAndCacheImage(
  itemCode: string,
  description: string,
  department: string,
  barcode?: string | null,
): Promise<string | null> {
  // Check cache first
  const cached = await getCachedImageUrl(itemCode)
  if (cached !== null) return cached || null // empty string = "no image found"

  // Try barcode search first, then fall back to name search
  let imageUrl = await serperImageSearch(buildSearchQuery(description, department, barcode))

  // If barcode search failed to find results (not an error), try name-based search
  if (imageUrl === null && barcode) {
    imageUrl = await serperImageSearch(buildSearchQuery(description, department))
  }

  // Don't cache transient errors — only cache real results (found or genuinely not found)
  if (imageUrl === 'error') {
    return null
  }

  // Cache result (empty string = "no image found, don't retry")
  await db.imageCache.put({
    itemCode,
    imageUrl: imageUrl ?? '',
    fetchedAt: new Date(),
  })

  return imageUrl
}

// ── Batch prefetch for high-velocity items ─────────────────────────────────

export interface PrefetchProgress {
  total: number
  done: number
  found: number
  errors: number
  current: string
}

export async function prefetchImages(
  items: { itemCode: string; description: string; department: string; barcode?: string | null }[],
  onProgress?: (p: PrefetchProgress) => void,
  signal?: AbortSignal,
): Promise<{ fetched: number; found: number }> {
  let done = 0
  let found = 0
  let errors = 0

  for (const item of items) {
    if (signal?.aborted) break

    // Skip if already cached
    const existing = await db.imageCache.get(item.itemCode)
    if (existing) {
      done++
      if (existing.imageUrl) found++
      onProgress?.({ total: items.length, done, found, errors, current: item.description })
      continue
    }

    const url = await fetchAndCacheImage(item.itemCode, item.description, item.department, item.barcode)
    done++
    if (url) {
      found++
    } else {
      // Check if it was cached as empty (not found) vs error (not cached)
      const entry = await db.imageCache.get(item.itemCode)
      if (!entry) errors++ // wasn't cached = was an error
    }
    onProgress?.({ total: items.length, done, found, errors, current: item.description })

    // Rate limit: ~1 request per second to stay within API limits
    await new Promise(r => setTimeout(r, 1100))
  }

  return { fetched: done, found }
}

export async function clearImageCache(): Promise<number> {
  const count = await db.imageCache.count()
  await db.imageCache.clear()
  return count
}

export { cleanDescription, buildSearchQuery }
