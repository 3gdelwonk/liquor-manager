import { useState, useEffect } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import type { CloudStatus } from '../../lib/jarvis'
import { getCloudStatus } from '../../lib/jarvis'

interface CloudStatusBadgeProps {
  onTap: () => void
  refreshTrigger?: number // increment to force refresh
}

export default function CloudStatusBadge({ onTap, refreshTrigger }: CloudStatusBadgeProps) {
  const [status, setStatus] = useState<CloudStatus | null>(null)

  useEffect(() => {
    getCloudStatus().then(setStatus)
  }, [refreshTrigger])

  const color = !status ? 'text-gray-400'
    : status.loggedIn && status.workingHours !== false ? 'text-green-500'
    : status.loggedIn ? 'text-amber-500'
    : 'text-red-500'

  const Icon = status?.loggedIn ? Cloud : CloudOff

  return (
    <button
      onClick={onTap}
      className={`flex items-center gap-1 px-2 py-1 rounded-full hover:bg-gray-100 transition-colors ${color}`}
      title={status?.message ?? (status?.loggedIn ? 'POS cloud connected' : 'POS cloud disconnected')}
    >
      <Icon size={14} />
      <span className={`w-2 h-2 rounded-full ${
        !status ? 'bg-gray-300'
        : status.loggedIn && status.workingHours !== false ? 'bg-green-500'
        : status.loggedIn ? 'bg-amber-500'
        : 'bg-red-500'
      }`} />
    </button>
  )
}

export { type CloudStatus }
