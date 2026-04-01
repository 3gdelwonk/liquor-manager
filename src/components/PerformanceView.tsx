import { useState, useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import {
  getLatestQoh, classifyABC, classifyXYZ, computePerformance, stockValue, opportunityMatrix,
  snapshotAgeDays, needsReplenishment,
} from '../lib/analytics'
import { getPromotions } from '../lib/jarvis'
import { useTrackedItemCodes } from '../lib/useTrackedItems'
import type { StockPerformance } from '../lib/types'
import { LEAD_TIME_DEFAULT } from '../lib/constants'

type SubView = 'table' | 'matrix'
type SortCol = 'name' | 'qoh' | 'days' | 'velocity' | 'trend' | 'gmroi' | 'abc' | 'xyz'

const ABC_COLORS: Record<string, string> = { A: 'bg-green-100 text-green-700', B: 'bg-blue-100 text-blue-700', C: 'bg-amber-100 text-amber-700', D: 'bg-gray-100 text-gray-500' }
const XYZ_COLORS: Record<string, string> = { X: 'bg-green-100 text-green-700', Y: 'bg-yellow-100 text-yellow-700', Z: 'bg-red-100 text-red-700' }

const QUADRANT_CONFIG = {
  star:        { label: 'Star',        color: '#10b981', bg: 'bg-green-50',  border: 'border-green-200', desc: 'Reorder soon' },
  opportunity: { label: 'Opportunity', color: '#3b82f6', bg: 'bg-blue-50',   border: 'border-blue-200',  desc: 'Watch levels' },
  overstock:   { label: 'Overstock',   color: '#f59e0b', bg: 'bg-amber-50',  border: 'border-amber-200', desc: 'Reduce order' },
  deadweight:  { label: 'Deadweight',  color: '#ef4444', bg: 'bg-red-50',    border: 'border-red-200',   desc: 'Clear/discontinue' },
}

export default function PerformanceView() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const snapshots = useLiveQuery(() => db.stockSnapshots.toArray(), [])
  const salesRecords = useLiveQuery(() => db.salesRecords.toArray(), [])

  const [subView, setSubView] = useState<SubView>('table')
  const [sortCol, setSortCol] = useState<SortCol>('velocity')
  const [sortAsc, setSortAsc] = useState(false)
  const [deadOpen, setDeadOpen] = useState(false)
  const [matrixTip, setMatrixTip] = useState<number | null>(null)
  const [promoItemCodes, setPromoItemCodes] = useState<Set<string>>(new Set())
  const trackedItemCodes = useTrackedItemCodes()

  useEffect(() => {
    getPromotions().then(data => {
      const today = new Date().toISOString().slice(0, 10)
      const codes = new Set(data.items.filter(p => p.startDate.slice(0, 10) <= today).map(p => p.itemCode))
      setPromoItemCodes(codes)
    }).catch(() => {})
  }, [])

  const leadTime = LEAD_TIME_DEFAULT

  const computed = useMemo(() => {
    if (!products || !snapshots || !salesRecords) return null

    const latestQoh = getLatestQoh(snapshots)
    const abcMap = classifyABC(products, salesRecords)
    const xyzMap = classifyXYZ(products, salesRecords)

    const perfMap = new Map<number, StockPerformance>()
    for (const p of products) {
      if (p.id === undefined) continue
      const abc = abcMap.get(p.id) ?? 'D'
      const xyz = xyzMap.get(p.id) ?? 'Z'
      perfMap.set(p.id, computePerformance(p, { snapshots, salesRecords, abcClass: abc, xyzClass: xyz }))
    }

    const sv = stockValue(products, latestQoh)
    const qohMap = latestQoh

    const matrix = opportunityMatrix(products, latestQoh, perfMap)

    // ABC distribution
    const abcDist = { A: 0, B: 0, C: 0, D: 0 }
    const xyzDist = { X: 0, Y: 0, Z: 0 }
    for (const [id, cls] of abcMap) { if (products.some(p => p.id === id)) abcDist[cls]++ }
    for (const [id, cls] of xyzMap) { if (products.some(p => p.id === id)) xyzDist[cls]++ }

    const deadStock = products.filter(p => p.id && abcMap.get(p.id) === 'D' && (latestQoh.get(p.id) ?? 0) > 0)
      .map(p => ({ product: p, qoh: latestQoh.get(p.id!) ?? 0, value: (latestQoh.get(p.id!) ?? 0) * p.costPrice }))
      .sort((a, b) => b.value - a.value)

    const deadValue = deadStock.reduce((s, d) => s + d.value, 0)

    return { latestQoh, abcMap, xyzMap, perfMap, sv, qohMap, matrix, abcDist, xyzDist, deadStock, deadValue }
  }, [products, snapshots, salesRecords])

  if (!products || !computed) return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>

  if (!products.length) return <div className="flex items-center justify-center h-full"><p className="text-sm text-gray-400">Import products first</p></div>

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  const rows = useMemo(() => {
    if (!products || !computed) return []
    return [...products]
      .filter(p => p.id !== undefined)
      .map(p => ({
        product: p,
        qoh: computed.latestQoh.get(p.id!) ?? null,
        perf: computed.perfMap.get(p.id!)!,
        ageDays: snapshotAgeDays(snapshots ?? [], p.id!),
      }))
      .sort((a, b) => {
        let diff = 0
        switch (sortCol) {
          case 'name':     diff = a.product.name.localeCompare(b.product.name); break
          case 'qoh':      diff = (a.qoh ?? -1) - (b.qoh ?? -1); break
          case 'days':     diff = (a.perf?.daysOfStock ?? 9999) - (b.perf?.daysOfStock ?? 9999); break
          case 'velocity': diff = (a.perf?.velocity ?? 0) - (b.perf?.velocity ?? 0); break
          case 'trend':    diff = (a.perf?.trend ?? 0) - (b.perf?.trend ?? 0); break
          case 'gmroi':    diff = (a.perf?.gmroi ?? 0) - (b.perf?.gmroi ?? 0); break
          case 'abc':      diff = (a.perf?.abcClass ?? 'Z').localeCompare(b.perf?.abcClass ?? 'Z'); break
          case 'xyz':      diff = (a.perf?.xyzClass ?? 'Z').localeCompare(b.perf?.xyzClass ?? 'Z'); break
        }
        return sortAsc ? diff : -diff
      })
  }, [products, computed, snapshots, sortCol, sortAsc])

  const total = products.length || 1
  const SortHeader = ({ col, label }: { col: SortCol; label: string }) => (
    <th className="py-2 px-2 text-left font-medium cursor-pointer whitespace-nowrap select-none" onClick={() => handleSort(col)}>
      {label}{sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
      <div className="flex border-b border-gray-100 bg-white">
        {(['table', 'matrix'] as SubView[]).map(v => (
          <button key={v} onClick={() => setSubView(v)} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${subView === v ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-500'}`}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {subView === 'table' ? (
          <div className="p-4 space-y-4 pb-8">
            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Stock Value</p>
                <p className="text-base font-bold">${computed.sv.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Dead Stock</p>
                <p className="text-base font-bold text-red-600">{computed.deadStock.length}</p>
              </div>
            </div>

            {/* ABC / XYZ bars */}
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500 mb-1">ABC Distribution</p>
                <div className="flex rounded-lg overflow-hidden h-6 gap-px">
                  {(['A', 'B', 'C', 'D'] as const).map(cls => {
                    const count = computed.abcDist[cls]
                    const pct = (count / total) * 100
                    if (!count) return null
                    const bg = cls === 'A' ? 'bg-green-400' : cls === 'B' ? 'bg-blue-400' : cls === 'C' ? 'bg-amber-400' : 'bg-gray-300'
                    return <div key={cls} className={`${bg} flex items-center justify-center text-xs text-white font-medium`} style={{ width: `${pct}%` }}>{count > 2 ? cls : ''}</div>
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">XYZ Distribution</p>
                <div className="flex rounded-lg overflow-hidden h-6 gap-px">
                  {(['X', 'Y', 'Z'] as const).map(cls => {
                    const count = computed.xyzDist[cls]
                    const pct = (count / total) * 100
                    if (!count) return null
                    const bg = cls === 'X' ? 'bg-green-400' : cls === 'Y' ? 'bg-yellow-400' : 'bg-red-400'
                    return <div key={cls} className={`${bg} flex items-center justify-center text-xs text-white font-medium`} style={{ width: `${pct}%` }}>{count > 2 ? cls : ''}</div>
                  })}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto -mx-4">
              <table className="w-full text-xs min-w-[560px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <SortHeader col="name" label="Product" />
                    <SortHeader col="qoh" label="QOH" />
                    <SortHeader col="days" label="Days" />
                    <SortHeader col="velocity" label="Vel/d" />
                    <SortHeader col="trend" label="Trend" />
                    <SortHeader col="gmroi" label="GMROI" />
                    <SortHeader col="abc" label="ABC" />
                    <SortHeader col="xyz" label="XYZ" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ product, qoh, perf, ageDays }) => {
                    const daysColor = perf?.daysOfStock !== null
                      ? perf!.daysOfStock! <= 2 ? 'text-red-600 font-semibold' : perf!.daysOfStock! >= 14 ? 'text-amber-600' : ''
                      : ''
                    const trendColor = (perf?.trend ?? 0) >= 0 ? 'text-green-600' : 'text-red-500'
                    const replenish = perf && needsReplenishment(qoh, perf.velocity, leadTime)
                    return (
                      <tr key={product.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2 px-2 max-w-[140px]">
                          <span className="truncate block">{product.name}</span>
                          {promoItemCodes.has(product.barcode) && <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-violet-100 text-violet-600">PROMO</span>}
                          {trackedItemCodes.has(product.barcode) && <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-cyan-100 text-cyan-700 ml-1">TRACKING</span>}
                          {replenish && <span className="text-red-500 text-[10px] ml-1">🔴 Reorder</span>}
                          {(ageDays ?? 0) > 7 && <span className="text-amber-500 text-[10px] ml-1">⚠️ Stale</span>}
                        </td>
                        <td className="py-2 px-2">{qoh ?? '—'}</td>
                        <td className={`py-2 px-2 ${daysColor}`}>{perf?.daysOfStock?.toFixed(1) ?? '—'}</td>
                        <td className="py-2 px-2">{perf?.velocity.toFixed(2) ?? '—'}</td>
                        <td className={`py-2 px-2 ${trendColor}`}>{perf?.trend !== undefined ? `${perf.trend >= 0 ? '+' : ''}${perf.trend.toFixed(0)}%` : '—'}</td>
                        <td className="py-2 px-2">{perf?.gmroi?.toFixed(2) ?? '—'}</td>
                        <td className="py-2 px-2"><span className={`px-1 py-0.5 rounded text-xs font-medium ${ABC_COLORS[perf?.abcClass ?? 'D']}`}>{perf?.abcClass ?? '—'}</span></td>
                        <td className="py-2 px-2"><span className={`px-1 py-0.5 rounded text-xs font-medium ${XYZ_COLORS[perf?.xyzClass ?? 'Z']}`}>{perf?.xyzClass ?? '—'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Dead stock collapsible */}
            {computed.deadStock.length > 0 && (
              <div className="border border-red-100 rounded-xl overflow-hidden">
                <button onClick={() => setDeadOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 bg-red-50 text-sm">
                  <span className="font-medium text-red-700">Dead Stock ({computed.deadStock.length} products)</span>
                  <span className="text-xs text-red-500">${computed.deadValue.toLocaleString('en-AU', { maximumFractionDigits: 0 })} tied up</span>
                </button>
                {deadOpen && (
                  <div className="divide-y divide-gray-100">
                    {computed.deadStock.map(({ product, qoh, value }) => (
                      <div key={product.id} className="flex items-center gap-2 px-4 py-2.5">
                        <span className="text-sm text-gray-700 flex-1 truncate">{product.name}</span>
                        <span className="text-xs text-gray-500 shrink-0">QOH {qoh} · ${value.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Matrix view */
          <div className="p-4 space-y-3 pb-8">
            <p className="text-xs text-gray-500">Products classified by velocity and stock level</p>
            <div className="grid grid-cols-2 gap-3">
              {(['star', 'opportunity', 'overstock', 'deadweight'] as const).map(q => {
                const conf = QUADRANT_CONFIG[q]
                const prods = products.filter(p => p.id && computed.matrix.get(p.id) === q)
                return (
                  <div key={q} className={`${conf.bg} border ${conf.border} rounded-xl p-3`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: conf.color }}>{conf.label}</span>
                      <span className="text-xs text-gray-500">{prods.length}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{conf.desc}</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {prods.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setMatrixTip(matrixTip === p.id ? null : p.id!)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: conf.color }} />
                            <span className="text-xs text-gray-700 truncate">{p.name}</span>
                          </div>
                          {matrixTip === p.id && (() => {
                            const perf = computed.perfMap.get(p.id!)
                            const qoh = computed.latestQoh.get(p.id!)
                            return (
                              <div className="mt-1 ml-3.5 text-xs text-gray-500 space-y-0.5">
                                <div>QOH: {qoh ?? '?'} · Vel: {perf?.velocity.toFixed(2) ?? '?'}/d</div>
                                <div>Days: {perf?.daysOfStock?.toFixed(1) ?? '?'} · GMROI: {perf?.gmroi?.toFixed(2) ?? '?'}</div>
                              </div>
                            )
                          })()}
                        </button>
                      ))}
                      {prods.length === 0 && <p className="text-xs text-gray-400 italic">None</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
