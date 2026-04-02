import { useState, useMemo, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp, Newspaper, BarChart2, RefreshCw, ExternalLink, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { db } from '../lib/db'
import type { NewsArticle } from '../lib/db'
import { categoryMomentum, topMovers, priceImpacts, promoROIs, dayOfWeekPatterns } from '../lib/insights'
import { fetchAllNews, getCachedNews, fetchABSRetail, getCachedABSData } from '../lib/marketData'
import { CATEGORY_LABELS, CATEGORY_COLORS, INSIGHT_COLORS, NEWS_TAG_COLORS } from '../lib/constants'
import type { LiquorCategory } from '../lib/types'

type SubTab = 'trends' | 'news' | 'market'

// ─── Trends Sub-tab ──────────────────────────────────────────────────────────

function TrendsTab() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const salesRecords = useLiveQuery(() => db.salesRecords.toArray(), [])
  const trackedItems = useLiveQuery(() => db.trackedItems.toArray(), [])
  const trackedPromos = useLiveQuery(() => db.trackedPromos.toArray(), [])

  const data = useMemo(() => {
    if (!products || !salesRecords) return null

    const momentum = categoryMomentum(products, salesRecords)
    const movers = topMovers(products, salesRecords)
    const impacts = trackedItems ? priceImpacts(trackedItems, salesRecords) : []
    const rois = trackedPromos ? promoROIs(trackedPromos, salesRecords) : []
    const dayPatterns = dayOfWeekPatterns(salesRecords)

    // Weekend vs weekday revenue share
    const totalDayRev = dayPatterns.reduce((s, d) => s + d.totalRevenue, 0)
    const weekendRev = dayPatterns.filter(d => d.day === 0 || d.day === 5 || d.day === 6).reduce((s, d) => s + d.totalRevenue, 0)
    const weekendPct = totalDayRev > 0 ? (weekendRev / totalDayRev) * 100 : 0

    return { momentum, movers, impacts, rois, dayPatterns, weekendPct }
  }, [products, salesRecords, trackedItems, trackedPromos])

  if (!products || !salesRecords) {
    return <div className="flex items-center justify-center h-40"><div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center px-6">
        <p className="text-sm text-gray-500">No product data yet</p>
        <p className="text-xs text-gray-400 mt-1">Import data or connect to JARVISmart to see trends</p>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-5">
      {/* Category Momentum */}
      <Section title="Category Momentum" subtitle="28d vs previous 28d revenue">
        {data.momentum.length === 0 ? (
          <EmptyCard message="No sales data for momentum analysis" />
        ) : (
          <div className="space-y-2">
            {data.momentum.map(m => (
              <div key={m.category} className="flex items-center gap-2 py-1.5">
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-medium w-16 text-center shrink-0"
                  style={{ background: (CATEGORY_COLORS[m.category as LiquorCategory] ?? '#9ca3af') + '22', color: CATEGORY_COLORS[m.category as LiquorCategory] ?? '#9ca3af' }}
                >
                  {CATEGORY_LABELS[m.category as LiquorCategory] ?? m.category}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-gray-700">${m.currentRevenue.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</span>
                    <ChangeIndicator value={m.changePercent} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Top Risers */}
      {data.movers.risers.length > 0 && (
        <Section title="Top Risers" subtitle="Biggest velocity increase (28d)">
          <div className="space-y-1.5">
            {data.movers.risers.map(m => (
              <MoverRow key={m.product.id} name={m.product.name} velocity={m.currentVelocity} change={m.changePercent} />
            ))}
          </div>
        </Section>
      )}

      {/* Top Fallers */}
      {data.movers.fallers.length > 0 && (
        <Section title="Top Fallers" subtitle="Biggest velocity drop (28d)">
          <div className="space-y-1.5">
            {data.movers.fallers.map(m => (
              <MoverRow key={m.product.id} name={m.product.name} velocity={m.currentVelocity} change={m.changePercent} />
            ))}
          </div>
        </Section>
      )}

      {/* Price Impact */}
      {data.impacts.length > 0 && (
        <Section title="Price Impact" subtitle="14d revenue before vs after price change">
          <div className="space-y-2">
            {data.impacts.slice(0, 5).map(imp => (
              <div key={imp.item.id} className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-700 truncate">{imp.item.description}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-500">
                    ${imp.item.originalPrice.toFixed(2)} → ${imp.item.newPrice.toFixed(2)}
                  </span>
                  <ChangeIndicator value={imp.revenueChangePercent} suffix=" rev" />
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-400">
                  <span>Before: {imp.qtyBefore} units / ${imp.revenueBefore.toFixed(0)}</span>
                  <span>After: {imp.qtyAfter} units / ${imp.revenueAfter.toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Promo ROI */}
      {data.rois.length > 0 && (
        <Section title="Promo ROI" subtitle="Incremental GP vs discount given">
          <div className="space-y-2">
            {data.rois.slice(0, 5).map(r => (
              <div key={r.promo.id} className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-700 truncate">{r.promo.description}</p>
                <div className="flex items-center gap-3 mt-1 text-xs">
                  <span className={r.roi >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ROI: {(r.roi * 100).toFixed(0)}%
                  </span>
                  <span className="text-gray-400">
                    GP: ${r.incrementalGP.toFixed(0)} / Discount: ${r.discountGiven.toFixed(0)}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-400">
                  <span>Promo qty: {r.promoQty} (was {r.baselineQty})</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Day-of-Week Pattern */}
      <Section title="Day Patterns" subtitle={`Fri-Sun = ${data.weekendPct.toFixed(0)}% of revenue (90d)`}>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.dayPatterns} margin={{ left: 0, right: 4, top: 4, bottom: 4 }}>
              <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
              <YAxis hide />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`, 'Avg Revenue']}
              />
              <Bar dataKey="avgRevenue" radius={[4, 4, 0, 0]}>
                {data.dayPatterns.map((entry) => (
                  <Cell
                    key={entry.day}
                    fill={entry.day === 0 || entry.day === 5 || entry.day === 6 ? INSIGHT_COLORS.accent : INSIGHT_COLORS.bar}
                    opacity={entry.day === 0 || entry.day === 5 || entry.day === 6 ? 1 : 0.5}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  )
}

// ─── News Sub-tab ────────────────────────────────────────────────────────────

function NewsTab() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)

  const cachedNews = useLiveQuery(() => getCachedNews(), [])

  const handleRefresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await fetchAllNews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch news')
    }
    setLoading(false)
  }, [])

  const filtered = useMemo(() => {
    if (!cachedNews) return []
    if (!filter) return cachedNews
    return cachedNews.filter(a => a.tags.includes(filter))
  }, [cachedNews, filter])

  const tagCounts = useMemo(() => {
    if (!cachedNews) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const a of cachedNews) {
      for (const t of a.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return counts
  }, [cachedNews])

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Australian liquor trade news</p>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-violet-600 font-medium disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Fetching...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-lg p-3">
          <p className="text-xs text-red-600">{error}</p>
          <p className="text-xs text-red-400 mt-1">CF Worker proxy endpoints may not be deployed yet</p>
        </div>
      )}

      {/* Tag filters */}
      {tagCounts.size > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilter(null)}
            className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
              !filter ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            All ({cachedNews?.length ?? 0})
          </button>
          {[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => (
            <button
              key={tag}
              onClick={() => setFilter(filter === tag ? null : tag)}
              className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                filter === tag ? 'text-white' : 'text-gray-600'
              }`}
              style={{
                backgroundColor: filter === tag ? (NEWS_TAG_COLORS[tag] ?? '#6b7280') : '#f3f4f6',
              }}
            >
              {tag} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Articles */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <Newspaper size={32} className="text-gray-200 mb-2" />
          <p className="text-sm text-gray-500">{cachedNews?.length ? 'No matching articles' : 'No news cached'}</p>
          <p className="text-xs text-gray-400 mt-1">Tap Refresh to fetch from trade publications</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.slice(0, 30).map((article) => (
            <NewsCard key={article.id ?? article.link} article={article} />
          ))}
        </div>
      )}
    </div>
  )
}

function NewsCard({ article }: { article: NewsArticle }) {
  const date = new Date(article.pubDate)
  const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-gray-50 rounded-lg p-3 active:bg-gray-100 transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-tight">{article.title}</p>
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{article.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-400">{daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`}</span>
            {article.tags.map(t => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ background: (NEWS_TAG_COLORS[t] ?? '#6b7280') + '22', color: NEWS_TAG_COLORS[t] ?? '#6b7280' }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <ExternalLink size={14} className="text-gray-300 shrink-0 mt-0.5" />
      </div>
    </a>
  )
}

// ─── Market Sub-tab ──────────────────────────────────────────────────────────

function MarketTab() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cachedABS = useLiveQuery(() => getCachedABSData(), [])

  // Store revenue from sales for comparison
  const salesRecords = useLiveQuery(() => db.salesRecords.toArray(), [])

  const handleRefresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await fetchABSRetail()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch ABS data')
    }
    setLoading(false)
  }, [])

  // Compute store monthly revenue for comparison
  const storeMonthly = useMemo(() => {
    if (!salesRecords || salesRecords.length === 0) return new Map<string, number>()
    const monthly = new Map<string, number>()
    for (const r of salesRecords) {
      const month = r.date.slice(0, 7) // "YYYY-MM"
      monthly.set(month, (monthly.get(month) ?? 0) + r.salesValue)
    }
    return monthly
  }, [salesRecords])

  // Latest quarter comparison
  const comparison = useMemo(() => {
    if (!cachedABS || cachedABS.length < 2) return null
    const sorted = [...cachedABS].sort((a, b) => b.period.localeCompare(a.period))
    const latest = sorted[0]
    const previous = sorted[1]

    const storeLatest = storeMonthly.get(latest.period) ?? 0
    const storePrevious = storeMonthly.get(previous.period) ?? 0
    const storeChange = storePrevious > 0 ? ((storeLatest - storePrevious) / storePrevious) * 100 : 0

    return { latest, previous, storeLatest, storePrevious, storeChange }
  }, [cachedABS, storeMonthly])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Victorian liquor retail turnover (ABS)</p>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-violet-600 font-medium disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Fetching...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-lg p-3">
          <p className="text-xs text-red-600">{error}</p>
          <p className="text-xs text-red-400 mt-1">CF Worker proxy endpoint may not be deployed yet</p>
        </div>
      )}

      {/* Comparison Card */}
      {comparison && (
        <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
          <p className="text-xs font-medium text-violet-700 mb-3">Latest Period: {comparison.latest.period}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500">Vic Market</p>
              <p className="text-lg font-bold text-gray-900">${comparison.latest.turnover.toFixed(0)}M</p>
              <ChangeIndicator value={comparison.latest.changePercent} />
            </div>
            <div>
              <p className="text-xs text-gray-500">Your Store</p>
              <p className="text-lg font-bold text-gray-900">
                {comparison.storeLatest > 0 ? `$${(comparison.storeLatest / 1000).toFixed(1)}K` : '—'}
              </p>
              {comparison.storeLatest > 0 && <ChangeIndicator value={comparison.storeChange} />}
            </div>
          </div>
        </div>
      )}

      {/* ABS Chart */}
      {cachedABS && cachedABS.length > 0 ? (
        <Section title="Monthly Turnover Trend" subtitle="Victorian liquor retail ($M)">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cachedABS.slice(-12)} margin={{ left: 0, right: 4, top: 4, bottom: 4 }}>
                <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis hide />
                <Tooltip
                  formatter={(v: number) => [`$${v.toFixed(0)}M`, 'Turnover']}
                  labelFormatter={(l: string) => `Period: ${l}`}
                />
                <Bar dataKey="turnover" fill={INSIGHT_COLORS.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <BarChart2 size={32} className="text-gray-200 mb-2" />
          <p className="text-sm text-gray-500">No market data cached</p>
          <p className="text-xs text-gray-400 mt-1">Tap Refresh to fetch ABS retail data</p>
        </div>
      )}

      {/* Store Monthly Revenue */}
      {storeMonthly.size > 0 && (
        <Section title="Your Monthly Revenue" subtitle="From imported sales data">
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...storeMonthly.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .slice(-12)
                  .map(([month, rev]) => ({ month, revenue: rev }))}
                margin={{ left: 0, right: 4, top: 4, bottom: 4 }}
              >
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis hide />
                <Tooltip
                  formatter={(v: number) => [`$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`, 'Revenue']}
                />
                <Bar dataKey="revenue" fill={INSIGHT_COLORS.bar} radius={[4, 4, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── Shared Components ───────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function ChangeIndicator({ value, suffix = '' }: { value: number; suffix?: string }) {
  const color = value > 0 ? INSIGHT_COLORS.up : value < 0 ? INSIGHT_COLORS.down : INSIGHT_COLORS.neutral
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : null

  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={{ color }}>
      {Icon && <Icon size={12} />}
      {value > 0 ? '+' : ''}{value.toFixed(1)}%{suffix}
    </span>
  )
}

function MoverRow({ name, velocity, change }: { name: string; velocity: number; change: number }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-sm text-gray-700 flex-1 truncate">{name}</span>
      <span className="text-xs font-mono text-gray-500 shrink-0">{velocity.toFixed(2)}/d</span>
      <ChangeIndicator value={change} />
    </div>
  )
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <p className="text-xs text-gray-400">{message}</p>
    </div>
  )
}

// ─── Main InsightsView ───────────────────────────────────────────────────────

export default function InsightsView() {
  const [subTab, setSubTab] = useState<SubTab>('trends')

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex border-b border-gray-200 bg-white shrink-0 px-4">
        {([
          { id: 'trends' as SubTab, label: 'Trends', icon: <TrendingUp size={14} /> },
          { id: 'news' as SubTab, label: 'News', icon: <Newspaper size={14} /> },
          { id: 'market' as SubTab, label: 'Market', icon: <BarChart2 size={14} /> },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              subTab === tab.id
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 pb-8">
        {subTab === 'trends' && <TrendsTab />}
        {subTab === 'news' && <NewsTab />}
        {subTab === 'market' && <MarketTab />}
      </div>
    </div>
  )
}
