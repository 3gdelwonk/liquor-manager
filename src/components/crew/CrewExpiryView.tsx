import { useState, useEffect, useMemo, useCallback } from 'react'
import { CalendarClock, AlertTriangle, Clock, Trash2, RefreshCw, Filter } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ExpiryRecord } from '../../lib/db'
import ProductImage from '../ProductImage'

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysUntil(iso: string) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(iso + 'T00:00:00')
  return Math.ceil((target.getTime() - now.getTime()) / 86400000)
}

type FilterMode = 'all' | 'expired' | '7days' | '30days'

export default function CrewExpiryView() {
  const [filter, setFilter] = useState<FilterMode>('all')

  const records = useLiveQuery(
    () => db.expiryRecords
      .where('status').equals('active')
      .sortBy('expiryDate'),
    []
  )

  const grouped = useMemo(() => {
    if (!records) return { expired: [], urgent: [], warning: [], ok: [] }

    const expired: ExpiryRecord[] = []
    const urgent: ExpiryRecord[] = []  // 0-7 days
    const warning: ExpiryRecord[] = [] // 8-30 days
    const ok: ExpiryRecord[] = []      // 30+ days

    for (const r of records) {
      const days = daysUntil(r.expiryDate)
      if (days <= 0) expired.push(r)
      else if (days <= 7) urgent.push(r)
      else if (days <= 30) warning.push(r)
      else ok.push(r)
    }

    return { expired, urgent, warning, ok }
  }, [records])

  const displayed = useMemo(() => {
    switch (filter) {
      case 'expired': return grouped.expired
      case '7days': return [...grouped.expired, ...grouped.urgent]
      case '30days': return [...grouped.expired, ...grouped.urgent, ...grouped.warning]
      default: return records ?? []
    }
  }, [filter, grouped, records])

  async function handleRemove(id: number) {
    await db.expiryRecords.update(id, { status: 'removed', updatedAt: new Date() })
  }

  async function handleClearExpired() {
    const ids = grouped.expired.map(r => r.id!).filter(Boolean)
    if (ids.length === 0) return
    await db.expiryRecords.bulkUpdate(ids.map(id => ({ key: id, changes: { status: 'removed' as const, updatedAt: new Date() } })))
  }

  if (!records) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <CalendarClock size={20} className="animate-pulse" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header stats */}
      <div className="px-4 pt-4 pb-3 shrink-0 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <StatCard
            label="Expired"
            count={grouped.expired.length}
            color="red"
            active={filter === 'expired'}
            onClick={() => setFilter(f => f === 'expired' ? 'all' : 'expired')}
          />
          <StatCard
            label="< 7 Days"
            count={grouped.urgent.length}
            color="orange"
            active={filter === '7days'}
            onClick={() => setFilter(f => f === '7days' ? 'all' : '7days')}
          />
          <StatCard
            label="< 30 Days"
            count={grouped.warning.length}
            color="amber"
            active={filter === '30days'}
            onClick={() => setFilter(f => f === '30days' ? 'all' : '30days')}
          />
          <StatCard
            label="All"
            count={records.length}
            color="gray"
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
        </div>

        {grouped.expired.length > 0 && (
          <button
            onClick={handleClearExpired}
            className="w-full py-2 bg-red-50 text-red-600 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 hover:bg-red-100 transition-colors"
          >
            <Trash2 size={12} /> Clear {grouped.expired.length} Expired Item{grouped.expired.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-4 pb-4 space-y-2">
        {displayed.length === 0 ? (
          <div className="text-center py-12 text-gray-300">
            <CalendarClock size={40} className="mx-auto mb-3" />
            <p className="text-sm text-gray-400">
              {filter !== 'all' ? 'No items in this category' : 'No expiry dates recorded yet'}
            </p>
            <p className="text-xs text-gray-300 mt-1">Add expiry dates from the Stock tab</p>
          </div>
        ) : (
          displayed.map(record => {
            const days = daysUntil(record.expiryDate)
            const isExpired = days <= 0
            const isUrgent = days > 0 && days <= 7
            const isWarning = days > 7 && days <= 30

            return (
              <div
                key={record.id}
                className={`flex items-center gap-3 border rounded-xl p-3 ${
                  isExpired ? 'border-red-200 bg-red-50'
                  : isUrgent ? 'border-orange-200 bg-orange-50'
                  : isWarning ? 'border-amber-200 bg-amber-50'
                  : 'border-gray-200 bg-white'
                }`}
              >
                <ProductImage
                  itemCode={record.itemCode}
                  description={record.description}
                  department={record.department}
                  barcode={record.barcode}
                  size={40}
                  className="rounded-lg shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{record.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-semibold ${
                      isExpired ? 'text-red-700' : isUrgent ? 'text-orange-700' : isWarning ? 'text-amber-700' : 'text-gray-600'
                    }`}>
                      {fmtDate(record.expiryDate)}
                    </span>
                    {record.quantity > 1 && (
                      <span className="text-[10px] text-gray-400">x{record.quantity}</span>
                    )}
                  </div>
                  {record.notes && (
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">{record.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                    isExpired ? 'bg-red-100 text-red-700'
                    : isUrgent ? 'bg-orange-100 text-orange-700'
                    : isWarning ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}>
                    {isExpired ? 'EXP' : `${days}d`}
                  </span>
                  <button
                    onClick={() => handleRemove(record.id!)}
                    className="text-gray-400 hover:text-red-500 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function StatCard({ label, count, color, active, onClick }: {
  label: string; count: number; color: 'red' | 'orange' | 'amber' | 'gray'; active: boolean; onClick: () => void
}) {
  const colors = {
    red: active ? 'bg-red-100 border-red-300 text-red-700' : 'bg-red-50 border-red-200 text-red-600',
    orange: active ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-orange-50 border-orange-200 text-orange-600',
    amber: active ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-amber-50 border-amber-200 text-amber-600',
    gray: active ? 'bg-gray-200 border-gray-400 text-gray-700' : 'bg-gray-50 border-gray-200 text-gray-600',
  }
  return (
    <button
      onClick={onClick}
      className={`border rounded-xl p-2 text-center transition-colors ${colors[color]}`}
    >
      <p className="text-lg font-bold">{count}</p>
      <p className="text-[9px] font-semibold uppercase">{label}</p>
    </button>
  )
}
