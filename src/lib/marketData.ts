import { db } from './db'
import type { NewsArticle, ABSDataPoint } from './db'

// ─── CF Worker proxy base URL ────────────────────────────────────────────────

const CF_BASE = 'https://api.jarvismart196410.uk'

// ─── News Sources ────────────────────────────────────────────────────────────

export const NEWS_SOURCES = [
  { id: 'theshout',    name: 'The Shout',    url: 'https://www.theshout.com.au/feed/' },
  { id: 'drinkstrade', name: 'Drinks Trade', url: 'https://www.drinkstrade.com.au/feed/' },
  { id: 'brewsnews',   name: 'Brews News',   url: 'https://www.brewsnews.com.au/feed/' },
] as const

export type NewsSourceId = typeof NEWS_SOURCES[number]['id']

// ─── Keyword tagging ─────────────────────────────────────────────────────────

const KEYWORD_TAGS: Record<string, string[]> = {
  beer:       ['beer', 'lager', 'ale', 'craft', 'brewery', 'brewing', 'hops', 'ipa', 'stout', 'pilsner'],
  wine:       ['wine', 'winery', 'vineyard', 'shiraz', 'chardonnay', 'pinot', 'sauvignon', 'cabernet', 'rosé', 'sparkling'],
  spirits:    ['spirits', 'whisky', 'whiskey', 'vodka', 'gin', 'rum', 'tequila', 'bourbon', 'brandy', 'distillery'],
  rtd:        ['rtd', 'ready to drink', 'premix', 'seltzer', 'hard seltzer', 'canned cocktail'],
  regulation: ['regulation', 'legislation', 'excise', 'tax', 'duty', 'licensing', 'compliance', 'law', 'government', 'policy'],
}

function tagArticle(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase()
  const tags: string[] = []
  for (const [tag, keywords] of Object.entries(KEYWORD_TAGS)) {
    if (keywords.some(kw => text.includes(kw))) {
      tags.push(tag)
    }
  }
  return tags
}

// ─── RSS Feed Fetching ───────────────────────────────────────────────────────

interface RSSItem {
  title: string
  link: string
  pubDate: string
  description: string
}

export async function fetchNews(sourceId: NewsSourceId): Promise<NewsArticle[]> {
  const res = await fetch(`${CF_BASE}/api/market/news?source=${sourceId}`)
  if (!res.ok) throw new Error(`News fetch failed: ${res.status}`)

  const items: RSSItem[] = await res.json()

  return items.map(item => ({
    sourceId,
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description,
    tags: tagArticle(item.title, item.description),
    fetchedAt: new Date(),
  }))
}

export async function fetchAndCacheNews(sourceId: NewsSourceId): Promise<NewsArticle[]> {
  const articles = await fetchNews(sourceId)

  // Upsert by link (unique identifier)
  await db.transaction('rw', db.newsArticles, async () => {
    for (const article of articles) {
      const existing = await db.newsArticles.where('link').equals(article.link).first()
      if (existing) {
        await db.newsArticles.update(existing.id!, { ...article, id: existing.id })
      } else {
        await db.newsArticles.add(article)
      }
    }
  })

  return articles
}

export async function fetchAllNews(): Promise<NewsArticle[]> {
  const all: NewsArticle[] = []
  const results = await Promise.allSettled(
    NEWS_SOURCES.map(s => fetchAndCacheNews(s.id))
  )
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
}

export async function getCachedNews(): Promise<NewsArticle[]> {
  return db.newsArticles.orderBy('pubDate').reverse().toArray()
}

// ─── ABS Retail Data ─────────────────────────────────────────────────────────

export async function fetchABSRetail(): Promise<ABSDataPoint[]> {
  const res = await fetch(`${CF_BASE}/api/market/abs-retail?state=VIC`)
  if (!res.ok) throw new Error(`ABS fetch failed: ${res.status}`)

  const data: ABSDataPoint[] = await res.json()

  // Cache in Dexie
  await db.transaction('rw', db.absData, async () => {
    await db.absData.clear()
    await db.absData.bulkAdd(data.map(d => ({ ...d, fetchedAt: new Date() })))
  })

  return data
}

export async function getCachedABSData(): Promise<ABSDataPoint[]> {
  return db.absData.orderBy('period').toArray()
}
