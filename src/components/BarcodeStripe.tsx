import { useRef, useEffect, useState } from 'react'
import JsBarcode from 'jsbarcode'

interface BarcodeStripeProps {
  value: string | null | undefined
  height?: number
  showText?: boolean
  className?: string
}

function detectFormat(value: string): string {
  if (/^\d{13}$/.test(value)) return 'EAN13'
  if (/^\d{12}$/.test(value)) return 'UPC'
  if (/^\d{8}$/.test(value)) return 'EAN8'
  return 'CODE128'
}

export default function BarcodeStripe({ value, height = 50, showText = true, className }: BarcodeStripeProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!value || !svgRef.current) return
    setError(false)
    try {
      JsBarcode(svgRef.current, value, {
        format: detectFormat(value),
        width: 1.5,
        height,
        displayValue: showText,
        fontSize: 12,
        margin: 4,
        background: 'transparent',
      })
    } catch {
      // Invalid barcode (bad checksum etc.) — try CODE128 fallback
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 1.5,
          height,
          displayValue: showText,
          fontSize: 12,
          margin: 4,
          background: 'transparent',
        })
      } catch {
        setError(true)
      }
    }
  }, [value, height, showText])

  if (!value) return null
  if (error) return <span className="text-xs text-gray-400 font-mono">{value}</span>

  return <svg ref={svgRef} className={className} />
}
