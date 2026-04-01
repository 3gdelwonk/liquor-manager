// ═══════════════════════════════════════════════
// Product Image Service
// Fetches product images via Google search, caches in IndexedDB
// ═══════════════════════════════════════════════

import { db } from './db'

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
  // Remove size info (750ML, 375ML, 4*200ML, etc.)
  let clean = desc.replace(/\d+\*?\d*\s*ML/gi, '').replace(/\d+\s*L\b/gi, '')
  // Remove pack counts (4S, 6PK, 10PK, 4X, etc.)
  clean = clean.replace(/\b\d+\s*(S|PK|X)\b/gi, '')
  // Expand abbreviations
  clean = clean.split(/[\s/]+/).map(word => {
    const upper = word.toUpperCase().replace(/[^A-Z/]/g, '')
    return ABBREV[upper] ?? word
  }).filter(w => w.length > 0).join(' ')
  // Remove extra whitespace
  return clean.replace(/\s+/g, ' ').trim()
}

function buildSearchQuery(description: string, department: string): string {
  const cleaned = cleanDescription(description)
  const deptHint = department === 'BEER' ? 'beer'
    : department === 'WINE' ? 'wine'
    : department === 'SPIRITS' ? 'spirits'
    : department === 'LIQUEURS' ? 'liqueur'
    : 'liquor'
  return `${cleaned} ${deptHint} bottle product`
}

// Google Custom Search API — user sets key in settings or we use env var
function getGoogleApiKey(): string {
  return localStorage.getItem('liquor-manager-google-api-key') || (import.meta.env.VITE_GOOGLE_API_KEY as string) || ''
}
function getGoogleCseId(): string {
  return localStorage.getItem('liquor-manager-google-cse-id') || (import.meta.env.VITE_GOOGLE_CSE_ID as string) || ''
}

export function isImageSearchConfigured(): boolean {
  return !!(getGoogleApiKey() && getGoogleCseId())
}

interface GoogleSearchResult {
  items?: { link: string; image?: { width: number; height: number } }[]
}

async function googleImageSearch(query: string): Promise<string | null> {
  const apiKey = getGoogleApiKey()
  const cseId = getGoogleCseId()
  if (!apiKey || !cseId) return null

  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: query,
    searchType: 'image',
    num: '1',
    imgSize: 'large',
    safe: 'active',
  })

  try {
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`)
    if (!res.ok) return null
    const data: GoogleSearchResult = await res.json()
    return data.items?.[0]?.link ?? null
  } catch {
    return null
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
): Promise<string | null> {
  // Check cache first
  const cached = await getCachedImageUrl(itemCode)
  if (cached !== null) return cached || null // empty string = "no image found"

  const query = buildSearchQuery(description, department)
  const imageUrl = await googleImageSearch(query)

  // Cache result (even if null, to avoid re-fetching)
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
  current: string
}

export async function prefetchImages(
  items: { itemCode: string; description: string; department: string }[],
  onProgress?: (p: PrefetchProgress) => void,
  signal?: AbortSignal,
): Promise<{ fetched: number; found: number }> {
  let done = 0
  let found = 0

  for (const item of items) {
    if (signal?.aborted) break

    // Skip if already cached
    const existing = await db.imageCache.get(item.itemCode)
    if (existing) {
      done++
      if (existing.imageUrl) found++
      onProgress?.({ total: items.length, done, found, current: item.description })
      continue
    }

    const url = await fetchAndCacheImage(item.itemCode, item.description, item.department)
    done++
    if (url) found++
    onProgress?.({ total: items.length, done, found, current: item.description })

    // Rate limit: ~1 request per second to stay within Google API limits
    await new Promise(r => setTimeout(r, 1100))
  }

  return { fetched: done, found }
}

export { cleanDescription, buildSearchQuery }
