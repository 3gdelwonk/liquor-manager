import { useState, useEffect, useRef, useCallback } from 'react'
import { Wine, Beer, GlassWater, RefreshCw, Search, X, Check } from 'lucide-react'
import {
  getCachedImageUrl, fetchAndCacheImage, deleteCachedImage,
  isImageSearchConfigured, searchProductImages, saveSelectedImage,
  type ImageOption
} from '../lib/images'

interface ProductImageProps {
  itemCode: string
  description: string
  department: string
  barcode?: string | null
  size?: number
  className?: string
}

const DEPT_ICONS: Record<string, typeof Wine> = {
  WINE: Wine,
  BEER: Beer,
  SPIRITS: GlassWater,
  LIQUEURS: GlassWater,
  'LIQUOR/MISC': GlassWater,
}

const DEPT_BG: Record<string, string> = {
  WINE: 'bg-violet-50 text-violet-300',
  BEER: 'bg-emerald-50 text-emerald-300',
  SPIRITS: 'bg-blue-50 text-blue-300',
  LIQUEURS: 'bg-amber-50 text-amber-300',
  'LIQUOR/MISC': 'bg-pink-50 text-pink-300',
}

// ── Image Picker Modal ─────────────────────────────────────────────────────

function ImagePicker({ itemCode, description, department, barcode, onSelect, onClose }: {
  itemCode: string
  description: string
  department: string
  barcode?: string | null
  onSelect: (url: string) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<ImageOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    searchProductImages(itemCode, description, department, barcode)
      .then(results => { if (!cancelled) setOptions(results) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [itemCode, description, department, barcode])

  async function handlePick(url: string) {
    setSaving(true)
    await saveSelectedImage(itemCode, url)
    onSelect(url)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Choose Image</h3>
            <p className="text-[10px] text-gray-400 truncate">{description}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Search size={20} className="text-violet-400 animate-pulse" />
              <p className="text-xs text-gray-400">Searching for images...</p>
            </div>
          ) : options.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <p className="text-xs text-gray-400">No images found</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handlePick(opt.imageUrl)}
                  disabled={saving}
                  className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-violet-400 transition-colors disabled:opacity-50"
                >
                  <img
                    src={opt.imageUrl}
                    alt={opt.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                    <p className="text-[8px] text-white/80 truncate">{opt.source}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {saving && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <div className="flex items-center gap-2">
              <Check size={16} className="text-green-600" />
              <span className="text-sm text-gray-600">Saved</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ProductImage({ itemCode, description, department, barcode, size = 48, className = '' }: ProductImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [refetching, setRefetching] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadImage() {
      const cached = await getCachedImageUrl(itemCode)
      if (cached && !cancelled) {
        setImageUrl(cached)
        return
      }

      if (isImageSearchConfigured() && cached === null) {
        const url = await fetchAndCacheImage(itemCode, description, department, barcode)
        if (url && !cancelled) {
          setImageUrl(url)
        }
      }
    }

    loadImage()
    return () => { cancelled = true }
  }, [itemCode, description, department])

  const handleRefetch = useCallback(async () => {
    setRefetching(true)
    setShowActions(false)
    await deleteCachedImage(itemCode)
    setImageUrl(null)
    setFailed(false)
    const url = await fetchAndCacheImage(itemCode, description, department, barcode)
    setImageUrl(url)
    setRefetching(false)
  }, [itemCode, description, department, barcode])

  function handleChoose() {
    setShowActions(false)
    setShowPicker(true)
  }

  function handleImageSelected(url: string) {
    setImageUrl(url)
    setFailed(false)
    setShowPicker(false)
  }

  function startLongPress() {
    longPressTimer.current = setTimeout(() => {
      setShowActions(true)
    }, 600)
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const Icon = DEPT_ICONS[department] ?? GlassWater
  const bgClass = DEPT_BG[department] ?? 'bg-gray-50 text-gray-300'

  const touchHandlers = {
    onTouchStart: startLongPress,
    onTouchEnd: cancelLongPress,
    onTouchCancel: cancelLongPress,
    onMouseDown: startLongPress,
    onMouseUp: cancelLongPress,
    onMouseLeave: cancelLongPress,
  }

  if (refetching) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass} ${className}`}
        style={{ width: size, height: size }}
      >
        <RefreshCw size={size * 0.4} className="animate-spin" />
      </div>
    )
  }

  const actionButtons = showActions && (
    <div className="absolute -top-1 -right-1 z-10 flex flex-col gap-0.5">
      <button
        onClick={handleRefetch}
        className="bg-violet-600 text-white rounded-full p-1 shadow-lg"
        title="Re-fetch image"
      >
        <RefreshCw size={12} />
      </button>
      <button
        onClick={handleChoose}
        className="bg-blue-600 text-white rounded-full p-1 shadow-lg"
        title="Choose image"
      >
        <Search size={12} />
      </button>
    </div>
  )

  const picker = showPicker && (
    <ImagePicker
      itemCode={itemCode}
      description={description}
      department={department}
      barcode={barcode}
      onSelect={handleImageSelected}
      onClose={() => setShowPicker(false)}
    />
  )

  if (!imageUrl || failed) {
    return (
      <div className="relative">
        <div
          className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass} ${className}`}
          style={{ width: size, height: size }}
          {...touchHandlers}
        >
          <Icon size={size * 0.5} />
        </div>
        {actionButtons}
        {picker}
      </div>
    )
  }

  return (
    <div className="relative">
      <img
        src={imageUrl}
        alt={description}
        className={`rounded-lg object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        loading="lazy"
        {...touchHandlers}
      />
      {actionButtons}
      {picker}
    </div>
  )
}
