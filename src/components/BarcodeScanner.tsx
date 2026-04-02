import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, AlertTriangle } from 'lucide-react'

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

  useEffect(() => {
    if (!open) return

    setError(null)
    activeRef.current = true

    const scanner = new Html5Qrcode('barcode-reader')
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 200 } },
        (decodedText) => {
          if (!activeRef.current) return
          activeRef.current = false
          // Fire-and-forget stop — do NOT await, or it deadlocks
          // (stop waits for this callback to return, callback waits for stop)
          scannerRef.current = null
          scanner.stop()
            .then(() => { try { scanner.clear() } catch {} })
            .catch(() => { try { scanner.clear() } catch {} })
          // Notify parent immediately
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
    // Fire-and-forget stop, close immediately
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
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <p className="text-sm font-medium text-white">Scan Barcode</p>
        <button onClick={handleClose} className="text-white/70 hover:text-white p-1">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div id="barcode-reader" className="w-full max-w-sm" />
      </div>
      {error ? (
        <div className="px-6 pb-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <p className="text-sm">{error}</p>
          </div>
          <button onClick={handleClose} className="text-sm text-white/70 underline">Close and try again</button>
        </div>
      ) : (
        <p className="text-center text-xs text-white/50 pb-6">Point camera at barcode, QR code, or any label</p>
      )}
    </div>
  )
}
