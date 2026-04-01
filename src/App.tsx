/// <reference types="vite-plugin-pwa/react" />
import { Component, useState, useRef, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { LayoutDashboard, Package, BarChart2, Tag, Upload, Settings, Activity } from 'lucide-react'
import { clearAllData } from './lib/db'
import { getStockLevels, LIQUOR_DEPT_NAMES } from './lib/jarvis'
import { prefetchImages, isImageSearchConfigured, clearImageCache, type PrefetchProgress } from './lib/images'
import Dashboard from './components/Dashboard'
import ProductsView from './components/ProductsView'
import PerformanceView from './components/PerformanceView'
import PromotionsView from './components/PromotionsView'
import ImportView from './components/ImportView'
import LiveSalesView from './components/LiveSalesView'

// ─── Update banner ────────────────────────────────────────────────────────────

function UpdateBanner() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-violet-600 text-white shrink-0 gap-3">
      <p className="text-sm">Update available — new version ready.</p>
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={() => updateServiceWorker(true)} className="text-sm font-semibold underline whitespace-nowrap">Refresh now</button>
        <button onClick={() => setNeedRefresh(false)} className="text-white/70 text-lg leading-none" aria-label="Dismiss">✕</button>
      </div>
    </div>
  )
}

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
          <button onClick={() => window.location.reload()} className="text-sm text-violet-600 underline">Reload app</button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Settings sheet ───────────────────────────────────────────────────────────

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [leadTime, setLeadTime] = useState(() => {
    return parseInt(localStorage.getItem('liquor-manager-lead-time') ?? '2', 10)
  })
  const [jarvisUrl, setJarvisUrl] = useState(
    () => localStorage.getItem('liquor-manager-jarvis-url') ?? (import.meta.env.VITE_JARVIS_URL as string) ?? ''
  )
  const [jarvisKey, setJarvisKey] = useState(
    () => localStorage.getItem('liquor-manager-jarvis-key') ?? (import.meta.env.VITE_JARVIS_API_KEY as string) ?? ''
  )
  const [serperApiKey, setSerperApiKey] = useState(
    () => localStorage.getItem('liquor-manager-serper-api-key') ?? (import.meta.env.VITE_SERPER_API_KEY as string) ?? ''
  )
  const [clearing, setClearing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [prefetching, setPrefetching] = useState(false)
  const [prefetchProgress, setPrefetchProgress] = useState<PrefetchProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function saveLead() {
    localStorage.setItem('liquor-manager-lead-time', String(leadTime))
  }

  function saveJarvis() {
    if (jarvisUrl.trim()) {
      localStorage.setItem('liquor-manager-jarvis-url', jarvisUrl.trim())
      localStorage.setItem('liquor-manager-jarvis-key', jarvisKey.trim())
    } else {
      localStorage.removeItem('liquor-manager-jarvis-url')
      localStorage.removeItem('liquor-manager-jarvis-key')
    }
  }

  function saveSerper() {
    if (serperApiKey.trim()) {
      localStorage.setItem('liquor-manager-serper-api-key', serperApiKey.trim())
    } else {
      localStorage.removeItem('liquor-manager-serper-api-key')
    }
  }

  async function handlePrefetch() {
    if (prefetching) {
      abortRef.current?.abort()
      setPrefetching(false)
      return
    }
    setPrefetching(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const stock = await getStockLevels({ limit: 5000 })
      // Filter to liquor, sort by avg daily qty descending (high velocity first)
      const liquorItems = stock
        .filter(s => LIQUOR_DEPT_NAMES.has(s.department))
        .sort((a, b) => b.avgDayQty - a.avgDayQty)
        .map(s => ({ itemCode: s.itemCode, description: s.description, department: s.department, barcode: s.barcode }))
      await prefetchImages(liquorItems, setPrefetchProgress, controller.signal)
    } catch { /* aborted or error */ }
    setPrefetching(false)
  }

  async function handleClear() {
    if (!confirm) { setConfirm(true); return }
    setClearing(true)
    await clearAllData()
    setClearing(false)
    setConfirm(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-6 space-y-5 pb-safe">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Settings</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Lead Time (days)</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={30}
              value={leadTime}
              onChange={(e) => setLeadTime(Number(e.target.value))}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <button onClick={saveLead} className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg">Save</button>
          </div>
          <p className="text-xs text-gray-400">Used for replenishment signals in Performance view</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">JARVISmart URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={jarvisUrl}
              onChange={(e) => setJarvisUrl(e.target.value)}
              placeholder="http://192.168.20.100:3100"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <button onClick={saveJarvis} className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg">Save</button>
          </div>
          <input
            type="text"
            value={jarvisKey}
            onChange={(e) => setJarvisKey(e.target.value)}
            placeholder="API key (optional on LAN)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <p className="text-xs text-gray-400">Live Sales tab connection. Use HTTPS URL when on GitHub Pages.</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Product Images (Serper.dev)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={serperApiKey}
              onChange={(e) => setSerperApiKey(e.target.value)}
              placeholder="Serper API Key (optional — default included)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <button onClick={saveSerper} className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg">Save</button>
          </div>
          <p className="text-xs text-gray-400">For product images via Google Images. Default key included (2,500 free queries).</p>
          {isImageSearchConfigured() && (
            <div className="mt-2">
              <button
                onClick={handlePrefetch}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  prefetching ? 'bg-amber-100 text-amber-700' : 'bg-violet-50 text-violet-600'
                }`}
              >
                {prefetching
                  ? `${prefetchProgress ? `${prefetchProgress.done}/${prefetchProgress.total} (${prefetchProgress.found} found${prefetchProgress.errors ? `, ${prefetchProgress.errors} errors` : ''})` : 'Starting...'} — tap to stop`
                  : 'Fetch Product Images'}
              </button>
              {prefetching && prefetchProgress && (
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {prefetchProgress.current}
                </p>
              )}
              <button
                onClick={async () => { const n = await clearImageCache(); alert(`Cleared ${n} cached entries. Images will be re-fetched.`) }}
                className="w-full mt-1 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200"
              >
                Clear Image Cache
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <button
            onClick={handleClear}
            disabled={clearing}
            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${confirm ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600'}`}
          >
            {clearing ? 'Clearing…' : confirm ? 'Tap again to confirm — this cannot be undone' : 'Clear All Data'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

type Tab = 'home' | 'products' | 'performance' | 'promos' | 'import' | 'live'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'home',        label: 'Home',      icon: <LayoutDashboard size={18} /> },
  { id: 'products',    label: 'Products',  icon: <Package size={18} /> },
  { id: 'performance', label: 'Perform',   icon: <BarChart2 size={18} /> },
  { id: 'promos',      label: 'Promos',    icon: <Tag size={18} /> },
  { id: 'import',      label: 'Import',    icon: <Upload size={18} /> },
  { id: 'live',        label: 'Live',      icon: <Activity size={18} /> },
]

const TAB_TITLES: Record<Tab, string> = {
  home:        'Liquor Manager',
  products:    'Products',
  performance: 'Performance',
  promos:      'Promotions',
  import:      'Import Data',
  live:        'Live Sales',
}

const LAST_TAB_KEY = 'liquor-manager-last-tab'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(LAST_TAB_KEY) as Tab | null
    return saved && TABS.some(t => t.id === saved) ? saved : 'home'
  })
  const [showSettings, setShowSettings] = useState(false)

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    localStorage.setItem(LAST_TAB_KEY, tab)
    setShowSettings(false)
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'home':        return <Dashboard onNavigateToImport={() => handleTabChange('import')} />
      case 'products':    return <ProductsView />
      case 'performance': return <PerformanceView />
      case 'promos':      return <PromotionsView />
      case 'import':      return <ImportView />
      case 'live':        return <LiveSalesView />
    }
  }

  return (
    <div className="flex flex-col h-screen-safe max-w-[480px] mx-auto bg-white relative">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
        <h1 className="text-base font-semibold text-gray-900">{TAB_TITLES[activeTab]}</h1>
        <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500" aria-label="Settings">
          <Settings size={18} />
        </button>
      </header>

      <UpdateBanner />

      <main className="flex-1 overflow-auto relative">
        <ErrorBoundary>{renderTab()}</ErrorBoundary>
      </main>

      <nav className="flex border-t border-gray-200 bg-white pb-safe shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center py-1.5 gap-0.5 text-[10px] font-medium transition-colors ${activeTab === tab.id ? 'text-violet-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {showSettings && <SettingsSheet onClose={() => setShowSettings(false)} />}
    </div>
  )
}
