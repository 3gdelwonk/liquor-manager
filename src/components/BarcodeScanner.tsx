import { useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onScan: (code: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ open, onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerRef = useRef<string>('barcode-reader')

  useEffect(() => {
    if (!open) return

    const scanner = new Html5Qrcode(containerRef.current)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 200 } },
        (decodedText) => {
          scanner.stop().catch(() => {})
          onScan(decodedText)
        },
        () => {},
      )
      .catch((err) => {
        console.error('Camera error:', err)
      })

    return () => {
      scanner.stop().catch(() => {})
      scannerRef.current = null
    }
  }, [open, onScan])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <p className="text-sm font-medium text-white">Scan Barcode</p>
        <button
          onClick={() => {
            scannerRef.current?.stop().catch(() => {})
            onClose()
          }}
          className="text-white/70 hover:text-white p-1"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div id={containerRef.current} className="w-full max-w-sm" />
      </div>
      <p className="text-center text-xs text-white/50 pb-6">Point camera at barcode, QR code, or any label</p>
    </div>
  )
}
