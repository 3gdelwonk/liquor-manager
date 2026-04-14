import { Component, useEffect, useState, type ReactNode } from 'react'
import { MapPin, DollarSign, Package, Printer } from 'lucide-react'
import BulkLocationSheet from './components/products/BulkLocationSheet'
import BulkAdjustSheet from './components/products/BulkAdjustSheet'
import CrewPriceSheet from './components/crew/CrewPriceSheet'
import CrewPrintWrapper from './components/crew/CrewPrintWrapper'

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

type WidgetId = 'location' | 'price' | 'qoh' | 'print'

interface Widget {
  id: WidgetId
  label: string
  icon: ReactNode
  tint: string
}

const WIDGETS: Widget[] = [
  { id: 'location', label: 'Bulk Location',  icon: <MapPin size={32} />,     tint: 'bg-violet-50 text-violet-600 border-violet-200' },
  { id: 'price',    label: 'Price / POS',    icon: <DollarSign size={32} />, tint: 'bg-green-50 text-green-600 border-green-200' },
  { id: 'qoh',      label: 'QOH Adjust',     icon: <Package size={32} />,    tint: 'bg-amber-50 text-amber-600 border-amber-200' },
  { id: 'print',    label: 'Print Labels',   icon: <Printer size={32} />,    tint: 'bg-sky-50 text-sky-600 border-sky-200' },
]

export default function CrewAppStandalone() {
  const [activeWidget, setActiveWidget] = useState<WidgetId | null>(null)

  // Lock portrait orientation. This must be an effect, not a useState
  // initializer — running it during render throws NotSupportedError on
  // desktop Chrome, which bubbles out of the render tree and blanks the
  // page before the ErrorBoundary can catch it.
  useEffect(() => {
    try {
      const orientation = screen?.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      orientation?.lock?.('portrait-primary')?.catch(() => {})
    } catch {
      /* desktop browsers throw synchronously — ignored */
    }
  }, [])

  const closeWidget = () => setActiveWidget(null)

  return (
    <div className="flex flex-col h-screen-safe max-w-[480px] mx-auto bg-white relative">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
        <h1 className="text-base font-semibold text-gray-900">Liquor Crew</h1>
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wide">Crew</span>
      </header>

      {/* Widget grid landing */}
      <main className="flex-1 overflow-auto">
        <ErrorBoundary>
          <div className="p-4">
            <p className="text-xs text-gray-400 text-center mb-3">Pick a tool</p>
            <div className="grid grid-cols-2 gap-3">
              {WIDGETS.map(w => (
                <button
                  key={w.id}
                  onClick={() => setActiveWidget(w.id)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 ${w.tint} py-8 active:scale-95 transition-transform`}
                >
                  {w.icon}
                  <span className="text-sm font-semibold">{w.label}</span>
                </button>
              ))}
            </div>
          </div>

          {activeWidget === 'location' && (
            <BulkLocationSheet items={[]} onClose={closeWidget} />
          )}
          {activeWidget === 'price' && (
            <CrewPriceSheet onClose={closeWidget} />
          )}
          {activeWidget === 'qoh' && (
            <BulkAdjustSheet items={[]} onClose={closeWidget} onSuccess={() => {}} />
          )}
          {activeWidget === 'print' && (
            <CrewPrintWrapper onClose={closeWidget} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
