import { useState, useEffect } from 'react'
import { Key, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react'
import type { CloudStatus } from '../../lib/jarvis'
import { getCloudStatus } from '../../lib/jarvis'
import { setCloudToken } from '../../lib/jarvisActions'

interface SetTokenSheetProps {
  onClose: () => void
  onSuccess: () => void
}

export default function SetTokenSheet({ onClose, onSuccess }: SetTokenSheetProps) {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    getCloudStatus().then(setStatus)
  }, [])

  async function handleSubmit() {
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await setCloudToken(token.trim())
      if (res.success) {
        setSuccess(true)
        setToken('')
        onSuccess()
        setTimeout(onClose, 1500)
      } else {
        setError(res.message ?? 'Failed to set token')
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
      <div className="relative bg-white rounded-t-2xl p-6 space-y-4 pb-safe">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">POS Cloud Login</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        {/* Current status */}
        {status && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {status.loggedIn ? (
                <CheckCircle size={16} className="text-green-500" />
              ) : (
                <XCircle size={16} className="text-red-500" />
              )}
              <span className={`font-medium ${status.loggedIn ? 'text-green-700' : 'text-red-700'}`}>
                {status.loggedIn ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {status.tokenAge && (
                <div className="flex items-center gap-1"><Clock size={10} /> Token age: {status.tokenAge}</div>
              )}
              {status.renewsIn && (
                <div>Renews in: {String(status.renewsIn)}</div>
              )}
              {status.expiresIn && (
                <div>Expires in: {String(status.expiresIn)}</div>
              )}
              {status.workingHours !== undefined && (
                <div>Working hours: {status.workingHours ? 'Yes' : 'No'}{status.schedule ? ` (${String(status.schedule)})` : ''}</div>
              )}
              {status.currentHour && (
                <div>Current time: {String(status.currentHour)}</div>
              )}
            </div>
            {status.message && <p className="text-xs text-gray-400">{status.message}</p>}
          </div>
        )}

        {/* Token input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">SR Auth Token</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Paste token here..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={busy || !token.trim()}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Set Token'}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 font-medium">{error}</p>
        )}
        {success && (
          <p className="text-xs text-green-600 font-medium flex items-center gap-1">
            <CheckCircle size={12} /> Token set successfully
          </p>
        )}
      </div>
    </div>
  )
}
