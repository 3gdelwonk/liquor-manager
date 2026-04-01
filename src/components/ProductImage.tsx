import { useState, useEffect } from 'react'
import { Wine, Beer, GlassWater } from 'lucide-react'
import { getCachedImageUrl, fetchAndCacheImage, isImageSearchConfigured } from '../lib/images'

interface ProductImageProps {
  itemCode: string
  description: string
  department: string
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

export default function ProductImage({ itemCode, description, department, size = 48, className = '' }: ProductImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadImage() {
      // Try cache first
      const cached = await getCachedImageUrl(itemCode)
      if (cached && !cancelled) {
        setImageUrl(cached)
        return
      }

      // If configured and not cached, fetch in background
      if (isImageSearchConfigured() && cached === null) {
        const url = await fetchAndCacheImage(itemCode, description, department)
        if (url && !cancelled) {
          setImageUrl(url)
        }
      }
    }

    loadImage()
    return () => { cancelled = true }
  }, [itemCode, description, department])

  const Icon = DEPT_ICONS[department] ?? GlassWater
  const bgClass = DEPT_BG[department] ?? 'bg-gray-50 text-gray-300'

  if (!imageUrl || failed) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass} ${className}`}
        style={{ width: size, height: size }}
      >
        <Icon size={size * 0.5} />
      </div>
    )
  }

  return (
    <img
      src={imageUrl}
      alt={description}
      className={`rounded-lg object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
