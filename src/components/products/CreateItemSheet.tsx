import { useState, useEffect } from 'react'
import { Loader2, CheckCircle, ScanBarcode } from 'lucide-react'
import { getDepartmentList, LIQUOR_DEPT_NAMES, type Department } from '../../lib/jarvis'
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
    reorderLevel: 1,
  })
  const [departments, setDepartments] = useState<Department[]>([])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    getDepartmentList()
      .then(depts => setDepartments(depts.filter(d => LIQUOR_DEPT_NAMES.has(d.name))))
      .catch(() => {
        // Fallback liquor departments
        setDepartments([
          { code: 20, name: 'LIQUEURS' },
          { code: 21, name: 'WINE' },
          { code: 22, name: 'SPIRITS' },
          { code: 23, name: 'LIQUOR/MISC' },
          { code: 25, name: 'BEER' },
        ])
      })
  }, [])

  function updateField(key: keyof CreateItemPayload, value: string | number) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleCreate() {
    if (!form.barcode?.trim() || !form.description?.trim() || !form.department) return
    setBusy(true)
    setError(null)
    try {
      const res = await createItem({
        barcode: form.barcode.trim(),
        description: form.description.trim(),
        department: form.department,
        sellPrice: Number(form.sellPrice) || 0,
        costPrice: Number(form.costPrice) || 0,
        reorderLevel: Number(form.reorderLevel) || 1,
        supplier: form.supplier?.trim() || undefined,
        orderCode: form.orderCode?.trim() || undefined,
        cartonQty: form.cartonQty ? Number(form.cartonQty) : undefined,
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
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
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
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        {/* Department */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Department</label>
          <select
            value={form.department ?? ''}
            onChange={e => updateField('department', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          >
            <option value="">Select department...</option>
            {departments.map(d => (
              <option key={d.code} value={d.name}>{d.name}</option>
            ))}
          </select>
        </div>

        {/* Price row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Sell Price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.sellPrice ?? ''}
              onChange={e => updateField('sellPrice', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Cost Price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.costPrice ?? ''}
              onChange={e => updateField('costPrice', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>

        {/* Reorder level */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Reorder Level</label>
          <input
            type="number"
            min="0"
            value={form.reorderLevel ?? ''}
            onChange={e => updateField('reorderLevel', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        {/* Optional fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Supplier (optional)</label>
            <input
              type="text"
              value={form.supplier ?? ''}
              onChange={e => updateField('supplier', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Order Code (optional)</label>
            <input
              type="text"
              value={form.orderCode ?? ''}
              onChange={e => updateField('orderCode', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
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
