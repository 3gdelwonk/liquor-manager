import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, AlertTriangle, Zap } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onScan: (code: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ open, onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  onScanRef.current = onScan
  onCloseRef.current = onClose
  const activeRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCode, setLastCode] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    setError(null)
    setLastCode(null)
    activeRef.current = true

    const scanner = new Html5Qrcode('barcode-reader')
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 180 } },
        (decodedText) => {
          if (!activeRef.current) return
          activeRef.current = false
          setLastCode(decodedText)
          scannerRef.current = null
          scanner.stop()
            .then(() => { try { scanner.clear() } catch {} })
            .catch(() => { try { scanner.clear() } catch {} })
          onScanRef.current(decodedText)
        },
        () => {},
      )
      .catch((err) => {
        setError(typeof err === 'string' ? err : (err as Error).message ?? 'Camera not available')
      })

    return () => {
      activeRef.current = false
      const s = scannerRef.current
      scannerRef.current = null
      if (s) {
        s.stop()
          .then(() => { try { s.clear() } catch {} })
          .catch(() => { try { s.clear() } catch {} })
      }
    }
  }, [open])

  function handleClose() {
    activeRef.current = false
    const s = scannerRef.current
    scannerRef.current = null
    if (s) {
      s.stop()
        .then(() => { try { s.clear() } catch {} })
        .catch(() => { try { s.clear() } catch {} })
    }
    onCloseRef.current()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-20">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-violet-400" />
          <p className="text-sm font-medium text-white">Scan Barcode</p>
        </div>
        <button onClick={handleClose} className="text-white/70 hover:text-white p-1">
          <X size={20} />
        </button>
      </div>

      {/* Camera feed + overlay */}
      <div className="flex-1 relative flex items-center justify-center">
        <div id="barcode-reader" className="w-full h-full" />

        {/* Scanning overlay */}
        {!error && !lastCode && (
          <div className="scanner-overlay">
            <div className="scanner-frame">
              <div className="scanner-corner tl" />
              <div className="scanner-corner tr" />
              <div className="scanner-corner bl" />
              <div className="scanner-corner br" />
              <div className="scanner-laser" />
            </div>
          </div>
        )}

        {/* Success flash */}
        {lastCode && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
            <div className="bg-green-500 text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg">
              Scanned: {lastCode}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {error ? (
        <div className="px-6 pb-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <p className="text-sm">{error}</p>
          </div>
          <button onClick={handleClose} className="text-sm text-white/70 underline">Close and try again</button>
        </div>
      ) : (
        <div className="text-center pb-6 space-y-1">
          <p className="text-xs text-white/50">Align barcode within the frame</p>
          <p className="text-[10px] text-white/30">EAN-13 · UPC · EAN-8 · Code 128</p>
        </div>
      )}
    </div>
  )
}
