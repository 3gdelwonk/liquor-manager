import { useState } from 'react'
import { Search, Loader2, ShoppingCart, BookOpen, ExternalLink } from 'lucide-react'
import type { StockItem, ShoppingResult, ResearchResult } from '../../lib/jarvis'
import { getShoppingComparison, getProductResearch } from '../../lib/jarvis'

interface ScoutSheetProps {
  item: StockItem
  onClose: () => void
}

type ScoutTab = 'shopping' | 'research'

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ScoutSheet({ item, onClose }: ScoutSheetProps) {
  const [tab, setTab] = useState<ScoutTab>('shopping')

  // Shopping state
  const [shoppingResults, setShoppingResults] = useState<ShoppingResult[] | null>(null)
  const [shoppingLoading, setShoppingLoading] = useState(false)
  const [shoppingError, setShoppingError] = useState<string | null>(null)

  // Research state
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null)
  const [researchLoading, setResearchLoading] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)

  async function fetchShopping() {
    setShoppingLoading(true)
    setShoppingError(null)
    try {
      const results = await getShoppingComparison(item.description)
      setShoppingResults(results)
    } catch (err) {
      setShoppingError((err as Error).message)
    } finally {
      setShoppingLoading(false)
    }
  }

  async function fetchResearch() {
    setResearchLoading(true)
    setResearchError(null)
    try {
      const result = await getProductResearch(item.description)
      setResearchResult(result)
    } catch (err) {
      setResearchError((err as Error).message)
    } finally {
      setResearchLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl p-6 space-y-4 pb-safe max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Product Scout</h2>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">✕</button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-sm font-medium text-gray-800">{item.description}</p>
          <p className="text-xs text-gray-500 mt-0.5">Your price: <strong>${fmtMoney(item.sellPrice)}</strong></p>
        </div>

        {/* Tab toggle */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab('shopping')}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'shopping' ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'
            }`}
          >
            <ShoppingCart size={14} /> Shopping
          </button>
          <button
            onClick={() => setTab('research')}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'research' ? 'text-violet-600 border-b-2 border-violet-600' : 'text-gray-400'
            }`}
          >
            <BookOpen size={14} /> Research
          </button>
        </div>

        {/* Shopping Tab */}
        {tab === 'shopping' && (
          <div className="space-y-3">
            {!shoppingResults && !shoppingLoading && (
              <button
                onClick={fetchShopping}
                className="w-full py-3 bg-violet-600 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                <Search size={16} /> Search Google Shopping
              </button>
            )}
            {shoppingLoading && (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-400 justify-center">
                <Loader2 size={16} className="animate-spin" /> Searching prices...
              </div>
            )}
            {shoppingError && <p className="text-xs text-red-600">{shoppingError}</p>}
            {shoppingResults && (
              <>
                {shoppingResults.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No shopping results found</p>
                ) : (
                  <div className="space-y-2">
                    {shoppingResults.map((r, i) => (
                      <div key={i} className="flex gap-3 bg-gray-50 rounded-lg p-3">
                        {r.thumbnail && (
                          <img src={r.thumbnail} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                        )}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-xs font-medium text-gray-800 truncate">{r.title}</p>
                          {r.price && <p className="text-sm font-semibold text-green-700">{r.price}</p>}
                          <div className="flex items-center gap-2">
                            {r.source && <span className="text-[10px] text-gray-400">{r.source}</span>}
                            {r.link && (
                              <a
                                href={r.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-violet-600 flex items-center gap-0.5"
                                onClick={e => e.stopPropagation()}
                              >
                                View <ExternalLink size={8} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={fetchShopping}
                  disabled={shoppingLoading}
                  className="w-full py-2 text-xs text-violet-600 font-medium border border-violet-200 rounded-lg hover:bg-violet-50"
                >
                  Refresh Results
                </button>
              </>
            )}
          </div>
        )}

        {/* Research Tab */}
        {tab === 'research' && (
          <div className="space-y-3">
            {!researchResult && !researchLoading && (
              <button
                onClick={fetchResearch}
                className="w-full py-3 bg-violet-600 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
              >
                <Search size={16} /> Research Product
              </button>
            )}
            {researchLoading && (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-400 justify-center">
                <Loader2 size={16} className="animate-spin" /> Researching...
              </div>
            )}
            {researchError && <p className="text-xs text-red-600">{researchError}</p>}
            {researchResult && (
              <>
                {/* Knowledge Graph */}
                {researchResult.knowledgeGraph && Object.keys(researchResult.knowledgeGraph).length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Knowledge Graph</p>
                    {Object.entries(researchResult.knowledgeGraph).map(([key, value]) => (
                      <div key={key} className="flex gap-2 text-xs">
                        <span className="text-gray-400 capitalize shrink-0">{key.replace(/_/g, ' ')}:</span>
                        <span className="text-gray-700">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* People Also Ask */}
                {researchResult.peopleAlsoAsk && researchResult.peopleAlsoAsk.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">People Also Ask</p>
                    {researchResult.peopleAlsoAsk.map((q, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-1">
                        <p className="text-xs font-medium text-gray-800">{q.question}</p>
                        {q.snippet && <p className="text-xs text-gray-500">{q.snippet}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {!researchResult.knowledgeGraph && !researchResult.peopleAlsoAsk && (
                  <p className="text-xs text-gray-400 text-center py-4">No research data found</p>
                )}

                <button
                  onClick={fetchResearch}
                  disabled={researchLoading}
                  className="w-full py-2 text-xs text-violet-600 font-medium border border-violet-200 rounded-lg hover:bg-violet-50"
                >
                  Refresh Results
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
