import { useState } from 'react'
import { Package, ScanBarcode, CalendarClock, ArrowLeftRight } from 'lucide-react'
import CrewStockView from './CrewStockView'
import CrewScanView from './CrewScanView'
import CrewExpiryView from './CrewExpiryView'

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

interface CrewAppProps {
  onSwitchMode: () => void
}

export default function CrewApp({ onSwitchMode }: CrewAppProps) {
  const [activeTab, setActiveTab] = useState<CrewTab>(() => {
    const saved = localStorage.getItem('crew-last-tab') as CrewTab | null
    return saved && CREW_TABS.some(t => t.id === saved) ? saved : 'stock'
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
    <>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
        <h1 className="text-base font-semibold text-gray-900">{TAB_TITLES[activeTab]}</h1>
        <button
          onClick={onSwitchMode}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-50 transition-colors"
          title="Switch to Manager"
        >
          <ArrowLeftRight size={14} />
          Manager
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto relative">
        {renderTab()}
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
    </>
  )
}
