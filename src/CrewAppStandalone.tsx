import { Component, useState, type ReactNode } from 'react'
import { Package, ScanBarcode, CalendarClock } from 'lucide-react'
import CrewStockView from './components/crew/CrewStockView'
import CrewScanView from './components/crew/CrewScanView'
import CrewExpiryView from './components/crew/CrewExpiryView'

// ─── Error boundary ───────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <p className="text-sm font-medium text-red-600">Something went wrong</p>
          <p className="text-xs text-gray-400">{this.state.message}</p>
          <button onClick={() => window.location.reload()} className="text-sm text-blue-600 underline">Reload app</button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Crew App ─────────────────────────────────────────────────────────────────

type CrewTab = 'stock' | 'scan' | 'expiry'

const CREW_TABS: { id: CrewTab; label: string; icon: React.ReactNode }[] = [
  { id: 'stock',  label: 'Stock',  icon: <Package size={18} /> },
  { id: 'scan',   label: 'Scan',   icon: <ScanBarcode size={18} /> },
  { id: 'expiry', label: 'Expiry', icon: <CalendarClock size={18} /> },
]

const TAB_TITLES: Record<CrewTab, string> = {
  stock:  'Stock',
  scan:   'Quick Scan',
  expiry: 'Expiry Tracker',
}

export default function CrewAppStandalone() {
  const [activeTab, setActiveTab] = useState<CrewTab>(() => {
    const saved = localStorage.getItem('crew-last-tab') as CrewTab | null
    return saved && CREW_TABS.some(t => t.id === saved) ? saved : 'stock'
  })

  // Lock portrait orientation
  useState(() => {
    const orientation = screen?.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    orientation?.lock?.('portrait-primary')?.catch(() => {})
  })

  function handleTabChange(tab: CrewTab) {
    setActiveTab(tab)
    localStorage.setItem('crew-last-tab', tab)
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'stock':  return <CrewStockView />
      case 'scan':   return <CrewScanView />
      case 'expiry': return <CrewExpiryView />
    }
  }

  return (
    <div className="flex flex-col h-screen-safe max-w-[480px] mx-auto bg-white relative">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
        <h1 className="text-base font-semibold text-gray-900">{TAB_TITLES[activeTab]}</h1>
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wide">Crew</span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto relative">
        <ErrorBoundary>{renderTab()}</ErrorBoundary>
      </main>

      {/* Bottom nav */}
      <nav className="flex border-t border-gray-200 bg-white pb-safe shrink-0">
        {CREW_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-[11px] font-semibold transition-colors ${
              activeTab === tab.id ? 'text-blue-600' : 'text-gray-400'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
