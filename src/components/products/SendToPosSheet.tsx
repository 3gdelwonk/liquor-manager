import { useState, useEffect, useRef } from 'react'
import {
  Send, X, Loader2, CheckCircle, AlertCircle, Pencil, Check,
  DollarSign, Tag, Wifi, WifiOff, Power, PowerOff, PackagePlus,
} from 'lucide-react'
import type { CloudStatus } from '../../lib/jarvis'
import { getCloudStatus } from '../../lib/jarvis'
import { sendToPos } from '../../lib/jarvisActions'
import {
  usePendingPosChanges,
  removePriceChange,
  removePromoChange,
  removeActiveChange,
  removeNewItem,
  updatePriceChange,
  updatePromoChange,
  clearAll,
} from '../../lib/pendingPosChanges'
import SetTokenSheet from './SetTokenSheet'

interface SendToPosSheetProps {
  onClose: () => void
  onSuccess: () => void
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeAgo(ts: number) {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

export default function SendToPosSheet({ onClose, onSuccess }: SendToPosSheetProps) {
  const state = usePendingPosChanges()
  const [cloud, setCloud] = useState<CloudStatus | null>(null)
  const [cloudLoading, setCloudLoading] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const mounted = useRef(true)

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  useEffect(() => { return () => { mounted.current = false } }, [])

  // Fetch cloud status on mount
  useEffect(() => {
    setCloudLoading(true)
    getCloudStatus()
      .then(s => { if (mounted.current) setCloud(s) })
      .catch(() => {})
      .finally(() => { if (mounted.current) setCloudLoading(false) })
  }, [])

  function refreshCloud() {
    setCloudLoading(true)
    getCloudStatus()
      .then(s => { if (mounted.current) setCloud(s) })
      .catch(() => {})
      .finally(() => { if (mounted.current) setCloudLoading(false) })
  }

  const totalCount =
    state.priceChanges.length +
    state.promoChanges.length +
    state.activeChanges.length +
    state.newItems.length
  const isConnected = cloud?.loggedIn === true

  // Start editing a price
  function startEdit(id: string, currentValue: number) {
    setEditingId(id)
    setEditValue(currentValue.toFixed(2))
  }

  function confirmEdit(id: string, type: 'price' | 'promo') {
    const val = Number(editValue)
    if (val > 0) {
      if (type === 'price') updatePriceChange(id, val)
      else updatePromoChange(id, val)
    }
    setEditingId(null)
    setEditValue('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }

  async function handleSendAll() {
    if (totalCount === 0) return

    // Re-check cloud status
    setError(null)
    try {
      const status = await getCloudStatus()
      if (mounted.current) setCloud(status)
      if (!status.loggedIn) {
        setShowToken(true)
        return
      }
    } catch {
      setError('Could not check cloud status')
      return
    }

    // Collect unique barcodes across every queued change type
    const barcodeSet = new Set<string>()
    for (const c of state.priceChanges)  barcodeSet.add(c.barcode)
    for (const c of state.promoChanges)  barcodeSet.add(c.barcode)
    for (const c of state.activeChanges) barcodeSet.add(c.barcode)
    for (const c of state.newItems)      if (c.barcode) barcodeSet.add(c.barcode)
    const items = [...barcodeSet].map(barcode => ({ barcode }))

    setSending(true)
    setProgress(`Sending ${items.length} item${items.length !== 1 ? 's' : ''}...`)

    try {
      const res = await sendToPos(items)
      if (!mounted.current) return
      if (res.success) {
        clearAll()
        setSuccess(true)
        onSuccess()
        setTimeout(onClose, 1500)
      } else {
        setError(res.message ?? 'Failed to send to POS')
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message)
    } finally {
      if (mounted.current) {
        setSending(false)
        setProgress('')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[90vh] pb-safe">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Send to POS</h2>
            {totalCount > 0 && (
              <p className="text-xs text-gray-400">
                {[
                  state.priceChanges.length  > 0 && `${state.priceChanges.length} price`,
                  state.promoChanges.length  > 0 && `${state.promoChanges.length} promo`,
                  state.activeChanges.length > 0 && `${state.activeChanges.length} active`,
                  state.newItems.length      > 0 && `${state.newItems.length} new`,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Cloud status banner */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          {cloudLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
              <Loader2 size={12} className="animate-spin" /> Checking cloud status...
            </div>
          ) : cloud ? (
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
              isConnected ? 'bg-green-50' : 'bg-red-50'
            }`}>
              <div className="flex items-center gap-2 text-sm">
                {isConnected ? (
                  <Wifi size={14} className="text-green-600" />
                ) : (
                  <WifiOff size={14} className="text-red-600" />
                )}
                <span className={`font-medium ${isConnected ? 'text-green-700' : 'text-red-700'}`}>
                  {isConnected ? 'Cloud Connected' : 'Cloud Disconnected'}
                </span>
                {cloud.tokenAge && (
                  <span className="text-xs text-gray-400">({cloud.tokenAge})</span>
                )}
              </div>
              {!isConnected && (
                <button
                  onClick={() => setShowToken(true)}
                  className="text-xs font-medium text-red-600 underline"
                >
                  Login
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-600 py-1">
              <AlertCircle size={12} /> Could not check cloud status
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-4 pb-2">
          {totalCount === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Send size={24} className="mx-auto text-gray-300" />
              <p className="text-sm text-gray-400">No pending changes</p>
              <p className="text-xs text-gray-300">Price changes and promotions will appear here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Price Changes */}
              {state.priceChanges.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <DollarSign size={12} /> Price Changes ({state.priceChanges.length})
                  </div>
                  {state.priceChanges.map(c => (
                    <div key={c.id} className="border border-gray-200 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate flex-1">{c.description}</p>
                        <button
                          onClick={() => removePriceChange(c.id)}
                          disabled={sending}
                          className="text-gray-300 hover:text-red-500 shrink-0 disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">${fmtMoney(c.oldPrice)}</span>
                        <span className="text-gray-300">→</span>
                        {editingId === c.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              className="w-20 px-1.5 py-0.5 text-xs font-medium border border-violet-300 rounded focus:outline-none focus:ring-1 focus:ring-violet-300"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmEdit(c.id, 'price')
                                if (e.key === 'Escape') cancelEdit()
                              }}
                            />
                            <button onClick={() => confirmEdit(c.id, 'price')} className="text-green-600">
                              <Check size={12} />
                            </button>
                            <button onClick={cancelEdit} className="text-gray-400">
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <span className="font-semibold text-gray-900 flex items-center gap-1">
                            ${fmtMoney(c.newPrice)}
                            {!sending && (
                              <button onClick={() => startEdit(c.id, c.newPrice)} className="text-gray-300 hover:text-violet-500">
                                <Pencil size={10} />
                              </button>
                            )}
                          </span>
                        )}
                        <span className="text-gray-300 ml-auto">{timeAgo(c.timestamp)}</span>
                      </div>
                      <p className="text-[10px] text-gray-300 font-mono">{c.barcode}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Active Status Changes */}
              {state.activeChanges.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Power size={12} /> Active Status ({state.activeChanges.length})
                  </div>
                  {state.activeChanges.map(c => (
                    <div key={c.id} className="border border-emerald-200 rounded-lg p-3 space-y-1 bg-emerald-50/30">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate flex-1">{c.description}</p>
                        <button
                          onClick={() => removeActiveChange(c.id)}
                          disabled={sending}
                          className="text-gray-300 hover:text-red-500 shrink-0 disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`flex items-center gap-1 ${c.oldActive ? 'text-gray-500' : 'text-gray-400'}`}>
                          {c.oldActive ? <Power size={10} /> : <PowerOff size={10} />}
                          {c.oldActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-gray-300">→</span>
                        <span className={`flex items-center gap-1 font-semibold ${c.newActive ? 'text-emerald-700' : 'text-gray-700'}`}>
                          {c.newActive ? <Power size={10} /> : <PowerOff size={10} />}
                          {c.newActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-gray-300 ml-auto">{timeAgo(c.timestamp)}</span>
                      </div>
                      <p className="text-[10px] text-gray-300 font-mono">{c.barcode}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* New Items */}
              {state.newItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <PackagePlus size={12} /> New Items ({state.newItems.length})
                  </div>
                  {state.newItems.map(c => (
                    <div key={c.id} className="border border-violet-200 rounded-lg p-3 space-y-1 bg-violet-50/30">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate flex-1">{c.description}</p>
                        <button
                          onClick={() => removeNewItem(c.id)}
                          disabled={sending}
                          className="text-gray-300 hover:text-red-500 shrink-0 disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-violet-700 font-medium">{c.department}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-700">${fmtMoney(c.sellPrice)}</span>
                        {c.costPrice > 0 && <span className="text-gray-400">cost ${fmtMoney(c.costPrice)}</span>}
                        <span className="text-gray-300 ml-auto">{timeAgo(c.timestamp)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-gray-300 font-mono">
                        <span>{c.barcode}</span>
                        {c.itemCode && <span>{c.itemCode}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Promotions */}
              {state.promoChanges.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Tag size={12} /> Promotions ({state.promoChanges.length})
                  </div>
                  {state.promoChanges.map(c => (
                    <div key={c.id} className="border border-amber-200 rounded-lg p-3 space-y-1 bg-amber-50/30">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate flex-1">{c.description}</p>
                        <button
                          onClick={() => removePromoChange(c.id)}
                          disabled={sending}
                          className="text-gray-300 hover:text-red-500 shrink-0 disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">${fmtMoney(c.normalPrice)}</span>
                        <span className="text-gray-300">→</span>
                        {editingId === c.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              className="w-20 px-1.5 py-0.5 text-xs font-medium border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-300"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmEdit(c.id, 'promo')
                                if (e.key === 'Escape') cancelEdit()
                              }}
                            />
                            <button onClick={() => confirmEdit(c.id, 'promo')} className="text-green-600">
                              <Check size={12} />
                            </button>
                            <button onClick={cancelEdit} className="text-gray-400">
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <span className="font-semibold text-amber-700 flex items-center gap-1">
                            ${fmtMoney(c.promoPrice)}
                            {!sending && (
                              <button onClick={() => startEdit(c.id, c.promoPrice)} className="text-gray-300 hover:text-amber-500">
                                <Pencil size={10} />
                              </button>
                            )}
                          </span>
                        )}
                        <span className="text-[10px] text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">{c.promoType.replace('_', ' ')}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-gray-400">
                        <span className="font-mono">{c.barcode}</span>
                        <span>{c.startDate} → {c.endDate}</span>
                        <span className="ml-auto">{timeAgo(c.timestamp)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 shrink-0">
          {success ? (
            <div className="flex items-center justify-center gap-2 text-green-600">
              <CheckCircle size={16} />
              <span className="text-sm font-medium">Sent to POS successfully</span>
            </div>
          ) : (
            <>
              <button
                onClick={handleSendAll}
                disabled={sending || totalCount === 0 || (!isConnected && !cloudLoading)}
                className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sending ? (
                  <><Loader2 size={16} className="animate-spin" /> {progress}</>
                ) : (
                  <><Send size={16} /> Send All to POS ({totalCount} item{totalCount !== 1 ? 's' : ''})</>
                )}
              </button>
              {error && <p className="text-xs text-red-600 font-medium text-center mt-2">{error}</p>}
              {!isConnected && !cloudLoading && totalCount > 0 && (
                <p className="text-[10px] text-amber-600 text-center mt-1">Cloud login required to send to POS</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Nested token sheet */}
      {showToken && (
        <SetTokenSheet
          onClose={() => setShowToken(false)}
          onSuccess={() => { setShowToken(false); refreshCloud() }}
        />
      )}
    </div>
  )
}
