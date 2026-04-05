import { useState, useEffect } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import type { CloudStatus } from '../../lib/jarvis'
import { getCloudStatus } from '../../lib/jarvis'

interface CloudStatusBadgeProps {
  onTap: () => void
  refreshTrigger?: number
}

export default function CloudStatusBadge({ onTap, refreshTrigger }: CloudStatusBadgeProps) {
  const [status, setStatus] = useState<CloudStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    getCloudStatus().then(s => {
      if (!cancelled) setStatus(s)
    }).catch(() => {
      if (!cancelled) setStatus({ loggedIn: false, message: 'Cannot reach POS cloud' })
    })
    return () => { cancelled = true }
  }, [refreshTrigger])

  // Determine state: green = logged in + working hours, amber = logged in but off-hours, red = not logged in
  const isConnected = status?.loggedIn === true
  const isWorking = status?.workingHours !== false

  const dotColor = !status ? 'bg-gray-300'
    : isConnected && isWorking ? 'bg-green-500'
    : isConnected ? 'bg-amber-500'
    : 'bg-red-500'

  const textColor = !status ? 'text-gray-400'
    : isConnected && isWorking ? 'text-green-500'
    : isConnected ? 'text-amber-500'
    : 'text-red-500'

  const Icon = isConnected ? Cloud : CloudOff
  const title = !status ? 'Checking POS cloud...'
    : status.message ?? (isConnected ? `POS cloud connected (${status.tokenAge ?? 'active'})` : 'POS cloud disconnected')

  return (
    <button
      onClick={onTap}
      className={`flex items-center gap-1 px-2 py-1 rounded-full hover:bg-gray-100 transition-colors ${textColor}`}
      title={title}
    >
      <Icon size={14} />
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
    </button>
  )
}
