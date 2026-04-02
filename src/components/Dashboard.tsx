import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Package, DollarSign, Clock, AlertTriangle } from 'lucide-react'
import { db } from '../lib/db'
import { getLatestQoh, classifyABC, stockValue, categorySummary } from '../lib/analytics'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/constants'
import type { LiquorCategory } from '../lib/types'

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-start gap-3 shadow-sm">
      <div className="p-1.5 bg-violet-50 rounded-lg text-violet-600">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-base font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const snapshots = useLiveQuery(() => db.stockSnapshots.toArray(), [])
  const salesRecords = useLiveQuery(() => db.salesRecords.toArray(), [])
  const importLog = useLiveQuery(() => db.importLog.orderBy('importedAt').reverse().limit(10).toArray(), [])

  const data = useMemo(() => {
    if (!products || !snapshots || !salesRecords) return null

    const latestQoh = getLatestQoh(snapshots)
    const abcMap = classifyABC(products, salesRecords)
    const sv = stockValue(products, latestQoh)
    const catSummary = categorySummary(products, snapshots, salesRecords)

    // Dead stock: ABC=D (zero sales 30d) and QOH > 0
    const deadCount = products.filter(p => p.id && abcMap.get(p.id!) === 'D' && (latestQoh.get(p.id!) ?? 0) > 0).length

    // Avg days of stock
    const avgDaily30 = products.filter(p => p.id).map(p => {
      const recs = salesRecords.filter(r => {
        const date30ago = new Date()
        date30ago.setDate(date30ago.getDate() - 30)
        return (r.barcode === p.barcode || r.productId === p.id) && new Date(r.date) >= date30ago
      })
      const qty = recs.reduce((s, r) => s + r.qtySold, 0) / 30
      return qty
    })
    const activeDailyAvg = avgDaily30.filter(v => v > 0)
    const avgDaysStock = activeDailyAvg.length > 0
      ? activeDailyAvg.map((vel, i) => {
          const p = products.filter(pr => pr.id)[i]
          if (!p?.id) return null
          const qoh = latestQoh.get(p.id) ?? 0
          return vel > 0 ? qoh / vel : null
        }).filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / activeDailyAvg.length
      : null

    // Velocity movers (last 30d)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const velocities: { product: typeof products[0]; vel: number; qoh: number; value: number }[] = products
      .filter(p => p.id)
      .map(p => {
        const recs = salesRecords.filter(r => (r.barcode === p.barcode || r.productId === p.id) && new Date(r.date) >= thirtyDaysAgo)
        const qty = recs.reduce((s, r) => s + r.qtySold, 0)
        const qoh = latestQoh.get(p.id!) ?? 0
        return { product: p, vel: qty / 30, qoh, value: qoh * p.costPrice }
      })
    const sorted = [...velocities].sort((a, b) => b.vel - a.vel)
    const top5 = sorted.slice(0, 5)
    const bottom5 = velocities.filter(v => v.vel === 0 && v.qoh > 0).sort((a, b) => b.value - a.value).slice(0, 5)

    // Stock health
    const healthStats = products.filter(p => p.id).reduce((acc, p) => {
      const qoh = latestQoh.get(p.id!) ?? null
      if (qoh === null) return acc
      const max = p.maxStockLevel ?? p.minStockLevel * 3
      if (qoh < p.minStockLevel) acc.low++
      else if (p.maxStockLevel && qoh > max) acc.over++
      else acc.healthy++
      return acc
    }, { low: 0, healthy: 0, over: 0 })

    // Last import per type
    const lastImports: Record<string, typeof importLog extends (infer T)[] | undefined ? T : never> = {}
    if (importLog) {
      for (const entry of importLog) {
        if (!lastImports[entry.type]) lastImports[entry.type] = entry
      }
    }

    return { sv, catSummary, deadCount, avgDaysStock, top5, bottom5, healthStats, lastImports }
  }, [products, snapshots, salesRecords, importLog])

  if (!products) return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>

  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <Package size={48} className="text-gray-200" />
        <div>
          <p className="text-sm font-medium text-gray-600">No local products</p>
          <p className="text-xs text-gray-400 mt-1">Data is fetched live from JARVISmart — check your connection in Settings</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-4 space-y-5 pb-8">

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={<Package size={16} />} label="Total SKUs" value={String(products.length)} />
        <KpiCard icon={<DollarSign size={16} />} label="Stock Value" value={`$${data.sv.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`} />
        <KpiCard
          icon={<Clock size={16} />}
          label="Avg Days Stock"
          value={data.avgDaysStock !== null ? `${data.avgDaysStock.toFixed(1)}d` : '—'}
        />
        <KpiCard icon={<AlertTriangle size={16} />} label="Dead Stock" value={String(data.deadCount)} sub="zero sales 30d" />
      </div>

      {/* Category Breakdown */}
      {data.catSummary.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Stock Value by Category</h2>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.catSummary} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <Tooltip
                  formatter={(v: number) => [`$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`, 'Stock Value']}
                  labelFormatter={(l: string) => CATEGORY_LABELS[l as LiquorCategory] ?? l}
                />
                <Bar dataKey="stockValue" radius={[0, 4, 4, 0]}>
                  {data.catSummary.map((entry) => (
                    <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category as LiquorCategory] ?? '#9ca3af'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Stock Health */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Stock Health</h2>
        <div className="flex gap-2">
          <div className="flex-1 text-center bg-red-50 border border-red-100 rounded-lg py-2">
            <p className="text-lg font-bold text-red-600">{data.healthStats.low}</p>
            <p className="text-xs text-red-500">Low</p>
          </div>
          <div className="flex-1 text-center bg-green-50 border border-green-100 rounded-lg py-2">
            <p className="text-lg font-bold text-green-600">{data.healthStats.healthy}</p>
            <p className="text-xs text-green-500">Healthy</p>
          </div>
          <div className="flex-1 text-center bg-amber-50 border border-amber-100 rounded-lg py-2">
            <p className="text-lg font-bold text-amber-600">{data.healthStats.over}</p>
            <p className="text-xs text-amber-500">Overstocked</p>
          </div>
        </div>
      </div>

      {/* Velocity Movers */}
      {data.top5.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Top 5 Fastest Sellers (30d)</h2>
          <div className="space-y-2">
            {data.top5.map(({ product, vel }) => (
              <div key={product.id} className="flex items-center gap-2 py-1">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium`} style={{ background: CATEGORY_COLORS[product.category] + '22', color: CATEGORY_COLORS[product.category] }}>
                  {CATEGORY_LABELS[product.category]}
                </span>
                <span className="text-sm text-gray-700 flex-1 truncate">{product.name}</span>
                <span className="text-xs font-mono text-gray-500 shrink-0">{vel.toFixed(2)}/d</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.bottom5.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Dead Stock (zero sales, has QOH)</h2>
          <div className="space-y-2">
            {data.bottom5.map(({ product, qoh, value }) => (
              <div key={product.id} className="flex items-center gap-2 py-1">
                <span className="text-sm text-gray-700 flex-1 truncate">{product.name}</span>
                <span className="text-xs text-gray-500 shrink-0">QOH {qoh} · ${value.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import Status */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Last Imports</h2>
        <div className="space-y-1.5">
          {(['item_maintenance', 'stock_report', 'sales'] as const).map((type) => {
            const entry = data.lastImports[type]
            return (
              <div key={type} className="w-full flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg text-left">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  type === 'item_maintenance' ? 'bg-violet-100 text-violet-700' :
                  type === 'stock_report' ? 'bg-blue-100 text-blue-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {type === 'item_maintenance' ? 'Item Maint' : type === 'stock_report' ? 'Stock' : 'Sales'}
                </span>
                <span className="text-xs text-gray-500 flex-1">
                  {entry ? `${entry.recordCount} records · ${new Date(entry.importedAt).toLocaleDateString('en-AU')}` : 'Never imported'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
