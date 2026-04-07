import { useState, useEffect, useMemo } from 'react'
import { Loader2, CheckCircle, ScanBarcode } from 'lucide-react'
import { getDepartmentList, LIQUOR_DEPT_CODES, type Department } from '../../lib/jarvis'
import { createItem, type CreateItemPayload } from '../../lib/jarvisActions'
import BarcodeScanner from '../BarcodeScanner'

interface CreateItemSheetProps {
  onClose: () => void
  onSuccess: () => void
}

export default function CreateItemSheet({ onClose, onSuccess }: CreateItemSheetProps) {
  const [form, setForm] = useState<Partial<CreateItemPayload>>({
    barcode: '',
    description: '',
    department: '',
    sellPrice: 0,
    costPrice: 0,
    gst: true,
    cartonQty: 1,
    reorderLevel: 1,
  })
  const [departments, setDepartments] = useState<Department[]>([])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  // Cost entry mode: 'total' = enter total + qty, 'unit' = enter cost price directly
  const [costMode, setCostMode] = useState<'total' | 'unit'>('unit')
  const [totalCost, setTotalCost] = useState('')
  const [totalQty, setTotalQty] = useState('')

  useEffect(() => {
    getDepartmentList()
      .then(depts => setDepartments(depts.filter(d => LIQUOR_DEPT_CODES.has(d.code))))
      .catch(() => {
        setDepartments([
          { code: 20, name: 'LIQUEURS' },
          { code: 21, name: 'WINE' },
          { code: 22, name: 'SPIRITS' },
          { code: 23, name: 'LIQUOR/MISC' },
          { code: 25, name: 'BEER' },
        ])
      })
  }, [])

  function updateField(key: keyof CreateItemPayload, value: string | number | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // When total cost or qty changes, recalculate unit cost
  useEffect(() => {
    if (costMode !== 'total') return
    const t = Number(totalCost) || 0
    const q = Number(totalQty) || 0
    if (q > 0) {
      updateField('costPrice', Math.round((t / q) * 100) / 100)
    }
  }, [totalCost, totalQty, costMode])

  // Calculate margin percentage: ((sell - cost) / sell) * 100
  const margin = useMemo(() => {
    const sell = Number(form.sellPrice) || 0
    const cost = Number(form.costPrice) || 0
    if (sell <= 0) return null
    const sellEx = form.gst ? sell / 1.1 : sell
    const m = ((sellEx - cost) / sellEx) * 100
    return m
  }, [form.sellPrice, form.costPrice, form.gst])

  async function handleCreate() {
    if (!form.barcode?.trim() || !form.description?.trim() || !form.department) return
    setBusy(true)
    setError(null)
    try {
      const selectedDept = departments.find(d => d.name === form.department)
      const res = await createItem({
        barcode: form.barcode.trim(),
        description: form.description.trim(),
        department: form.department,
        departmentCode: selectedDept?.code,
        sellPrice: Number(form.sellPrice) || 0,
        costPrice: Number(form.costPrice) || 0,
        gst: form.gst ?? true,
        cartonQty: form.cartonQty ? Number(form.cartonQty) : undefined,
        reorderLevel: Number(form.reorderLevel) || 1,
        supplier: form.supplier?.trim() || undefined,
        orderCode: form.orderCode?.trim() || undefined,
      })
      if (res.success) {
        setSuccess(true)
        onSuccess()
        setTimeout(onClose, 1200)
      } else {
        setError(res.message ?? 'Failed to create item')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300'
  const dollarInputCls = 'w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300'

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-6 space-y-4 pb-safe max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Create New Item</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Barcode */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Barcode</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.barcode ?? ''}
              onChange={e => updateField('barcode', e.target.value)}
              placeholder="Scan or enter barcode"
              className={'flex-1 ' + inputCls.replace('w-full ', '')}
            />
            <button
              onClick={() => setScannerOpen(true)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-violet-600"
            >
              <ScanBarcode size={18} />
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Description</label>
          <input
            type="text"
            value={form.description ?? ''}
            onChange={e => updateField('description', e.target.value)}
            placeholder="Product name"
            className={inputCls}
          />
        </div>

        {/* Department */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Department</label>
          <select
            value={form.department ?? ''}
            onChange={e => updateField('department', e.target.value)}
            className={inputCls + ' bg-white appearance-none'}
          >
            <option value="">Select department...</option>
            {departments.map(d => (
              <option key={d.code} value={d.name}>{d.name}</option>
            ))}
          </select>
          {departments.length === 0 && (
            <p className="text-xs text-amber-600">Loading departments...</p>
          )}
        </div>

        {/* Cost entry mode toggle */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Cost Price</label>
            <div className="ml-auto flex rounded-lg border border-gray-200 text-xs overflow-hidden">
              <button
                type="button"
                onClick={() => setCostMode('unit')}
                className={`px-3 py-1 ${costMode === 'unit' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}
              >
                Unit
              </button>
              <button
                type="button"
                onClick={() => setCostMode('total')}
                className={`px-3 py-1 ${costMode === 'total' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}
              >
                Total / Qty
              </button>
            </div>
          </div>

          {costMode === 'unit' ? (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice ?? ''}
                onChange={e => updateField('costPrice', e.target.value)}
                placeholder="0.00"
                className={dollarInputCls}
              />
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2 items-end">
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-gray-500">Total Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={totalCost}
                    onChange={e => setTotalCost(e.target.value)}
                    placeholder="0.00"
                    className={dollarInputCls}
                  />
                </div>
              </div>
              <div className="col-span-1 space-y-1">
                <label className="text-xs text-gray-500">Qty</label>
                <input
                  type="number"
                  min="1"
                  value={totalQty}
                  onChange={e => setTotalQty(e.target.value)}
                  placeholder="1"
                  className={inputCls}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-gray-500">Unit Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input
                    type="number"
                    readOnly
                    value={form.costPrice ?? ''}
                    className={dollarInputCls + ' bg-gray-50 text-gray-600'}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sell Price */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Sell Price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.sellPrice ?? ''}
              onChange={e => updateField('sellPrice', e.target.value)}
              placeholder="0.00"
              className={dollarInputCls}
            />
          </div>
        </div>

        {/* GST + Margin row */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.gst ?? true}
              onChange={e => updateField('gst', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-300"
            />
            <span className="text-sm font-medium text-gray-700">GST Inclusive</span>
          </label>
          <div className="ml-auto text-sm text-gray-500">
            Margin:{' '}
            {margin !== null ? (
              <span className={margin >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                {margin.toFixed(1)}%
              </span>
            ) : (
              <span className="text-gray-400">--</span>
            )}
          </div>
        </div>

        {/* Carton Qty + Reorder Level row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Units per Carton</label>
            <input
              type="number"
              min="1"
              value={form.cartonQty ?? ''}
              onChange={e => updateField('cartonQty', e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Reorder Level</label>
            <input
              type="number"
              min="0"
              value={form.reorderLevel ?? ''}
              onChange={e => updateField('reorderLevel', e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Optional fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Supplier (optional)</label>
            <input
              type="text"
              value={form.supplier ?? ''}
              onChange={e => updateField('supplier', e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Order Code (optional)</label>
            <input
              type="text"
              value={form.orderCode ?? ''}
              onChange={e => updateField('orderCode', e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={busy || !form.barcode?.trim() || !form.description?.trim() || !form.department}
          className="w-full py-3 bg-violet-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : success ? <CheckCircle size={16} /> : null}
          {success ? 'Item Created!' : busy ? 'Creating...' : 'Create & Send to POS'}
        </button>

        {error && <p className="text-xs text-red-600 font-medium text-center">{error}</p>}
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onScan={(code) => { setScannerOpen(false); updateField('barcode', code) }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  )
}
