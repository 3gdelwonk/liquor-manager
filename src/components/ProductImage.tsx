import { useState, useEffect, useRef, useCallback } from 'react'
import { Wine, Beer, GlassWater, RefreshCw } from 'lucide-react'
import { getCachedImageUrl, fetchAndCacheImage, deleteCachedImage, isImageSearchConfigured } from '../lib/images'

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

export default function ProductImage({ itemCode, description, department, barcode, size = 48, className = '' }: ProductImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [showRefetch, setShowRefetch] = useState(false)
  const [refetching, setRefetching] = useState(false)
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
    setShowRefetch(false)
    await deleteCachedImage(itemCode)
    setImageUrl(null)
    setFailed(false)
    const url = await fetchAndCacheImage(itemCode, description, department, barcode)
    setImageUrl(url)
    setRefetching(false)
  }, [itemCode, description, department, barcode])

  function startLongPress() {
    longPressTimer.current = setTimeout(() => {
      setShowRefetch(true)
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
        {showRefetch && (
          <button
            onClick={handleRefetch}
            className="absolute -top-1 -right-1 z-10 bg-violet-600 text-white rounded-full p-1 shadow-lg"
            title="Re-fetch image"
          >
            <RefreshCw size={12} />
          </button>
        )}
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
      {showRefetch && (
        <button
          onClick={handleRefetch}
          className="absolute -top-1 -right-1 z-10 bg-violet-600 text-white rounded-full p-1 shadow-lg"
          title="Re-fetch image"
        >
          <RefreshCw size={12} />
        </button>
      )}
    </div>
  )
}
