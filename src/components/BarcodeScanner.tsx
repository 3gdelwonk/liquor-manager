import { useEffect, useRef, useState, useCallback } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { X, AlertTriangle, Zap, ZapOff, ZoomIn, ZoomOut } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onScan: (code: string) => void
  onClose: () => void
}

// Retail-essential formats only. Each extra format adds per-frame decode
// cost on the ZXing JS fallback path (iOS Safari, old WebViews). Native
// BarcodeDetector is less affected but still benefits.
// Dropped vs. earlier: CODE_39 / ITF / QR_CODE — rarely present on individual
// liquor products, and when absent they just waste scan cycles.
const LIQUOR_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,   // ~95% of retail (AU/EU)
  Html5QrcodeSupportedFormats.UPC_A,    // US imports
  Html5QrcodeSupportedFormats.EAN_8,    // small-pack products
  Html5QrcodeSupportedFormats.UPC_E,    // compact UPC
  Html5QrcodeSupportedFormats.CODE_128, // supplier/logistics labels
]

export default function BarcodeScanner({ open, onScan, onClose }: BarcodeScannerProps) {
  const scannerRef   = useRef<Html5Qrcode | null>(null)
  const onScanRef    = useRef(onScan)
  const onCloseRef   = useRef(onClose)
  onScanRef.current  = onScan
  onCloseRef.current = onClose
  const activeRef    = useRef(false)
  const trackRef     = useRef<MediaStreamTrack | null>(null)

  const [error, setError]                   = useState<string | null>(null)
  const [lastCode, setLastCode]             = useState<string | null>(null)
  const [zoom, setZoom]                     = useState(1)
  const [zoomRange, setZoomRange]           = useState<{ min: number; max: number } | null>(null)
  const [torch, setTorch]                   = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)

  const applyZoom = useCallback((newZoom: number) => {
    const track = trackRef.current
    if (!track) return
    try {
      const caps    = track.getCapabilities?.() as Record<string, unknown> | undefined
      const zoomCap = caps?.zoom as { min?: number; max?: number } | undefined
      if (zoomCap?.max) {
        const clamped = Math.max(zoomCap.min ?? 1, Math.min(newZoom, zoomCap.max))
        track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] } as MediaTrackConstraints)
        setZoom(clamped)
      }
    } catch { /* zoom not supported */ }
  }, [])

  async function handleTorch() {
    const track = trackRef.current
    if (!track) return
    const next = !torch
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] } as MediaTrackConstraints)
      setTorch(next)
    } catch { /* torch not supported */ }
  }

  useEffect(() => {
    if (!open) return

    setError(null)
    setLastCode(null)
    setZoom(1)
    setZoomRange(null)
    setTorch(false)
    setTorchSupported(false)
    trackRef.current  = null
    activeRef.current = true

    // experimentalFeatures.useBarCodeDetectorIfSupported — on Chrome/Android this
    // delegates to the native BarcodeDetector API (ML Kit on Android, OS API on
    // desktop). The native detector handles damaged, low-contrast, and far-away
    // barcodes far better than the JS ZXing fallback.
    const scanner = new Html5Qrcode('barcode-reader', {
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      formatsToSupport: LIQUOR_FORMATS,
      verbose: false,
    })
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 20,
          // NO qrbox. Previously this was 340×160 — ~2.6% of a 1920×1080 frame.
          // html5-qrcode crops the video to qrbox and passes only that canvas
          // to BarcodeDetector, so barcodes outside the crop were invisible to
          // the detector even when visible to the user. Omitting qrbox defaults
          // the scan region to the full viewfinder (html5-qrcode internal,
          // setupUi line 488-489: `isNullOrUndefined(qrbox) ? full-viewfinder`),
          // so every pixel the camera captures is fed to the detector. This is
          // the single biggest sensitivity win available from config alone.
          aspectRatio: 1.777,
          disableFlip: true,       // 1D barcodes don't need mirror check; saves CPU
          videoConstraints: {
            // facingMode MUST live here — html5-qrcode ignores the first-arg
            // facingMode when videoConstraints is present (it takes full ownership
            // of the camera constraint, so the first arg is effectively unused).
            facingMode: { ideal: 'environment' },
            // Higher resolution = more pixels per bar. With full-frame scanning,
            // bumping to 2560×1440 gives BarcodeDetector ~78% more data to
            // resolve small, distant, or damaged barcodes. Browser negotiates
            // down automatically if the camera doesn't support it.
            width:     { ideal: 2560 },
            height:    { ideal: 1440 },
            frameRate: { ideal: 30, max: 60 },
          } as MediaTrackConstraints,
        },
        (decodedText) => {
          if (!activeRef.current) return
          activeRef.current  = false
          setLastCode(decodedText)
          scannerRef.current = null
          trackRef.current   = null
          scanner.stop()
            .then(() => { try { scanner.clear() } catch {} })
            .catch(() => { try { scanner.clear() } catch {} })
          onScanRef.current(decodedText)
        },
        () => {},
      )
      .then(() => {
        try {
          const videoEl = document.querySelector('#barcode-reader video') as HTMLVideoElement | null
          const track   = videoEl?.srcObject instanceof MediaStream
            ? videoEl.srcObject.getVideoTracks()[0]
            : null
          if (!track) return
          trackRef.current = track

          const caps = track.getCapabilities?.() as Record<string, unknown> | undefined

          // ── Zoom ──────────────────────────────────────────────────────────
          // Start at native minimum (1x) for the widest field of view. The
          // previous 20% default narrowed the FOV, forcing users to hit a
          // specific distance sweet spot — small misalignment meant no decode.
          // With full-frame scanning + 2560×1440 resolution we no longer need
          // to lean on zoom for pixel density. Users can tap + for shelf labels.
          const zoomCap = caps?.zoom as { min?: number; max?: number } | undefined
          if (zoomCap?.max && zoomCap.max > 1) {
            const min = zoomCap.min ?? 1
            const max = zoomCap.max
            setZoomRange({ min, max })
            setZoom(min)
          }

          // ── Torch ──────────────────────────────────────────────────────────
          if ((caps as Record<string, unknown> | undefined)?.torch) {
            setTorchSupported(true)
          }

          // ── Continuous autofocus ───────────────────────────────────────────
          const focusModes = (caps as Record<string, unknown> | undefined)?.focusMode as string[] | undefined
          if (focusModes?.includes('continuous')) {
            track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            } as MediaTrackConstraints).catch(() => {})
          }

          // ── Continuous exposure ────────────────────────────────────────────
          // Store lighting varies wildly (fluorescent aisles, shadowed shelves,
          // direct sun in carparks). Continuous exposure re-meters each frame
          // so glossy labels and dark corners both resolve. Silently skipped
          // on devices that don't expose the capability.
          const exposureModes = (caps as Record<string, unknown> | undefined)?.exposureMode as string[] | undefined
          if (exposureModes?.includes('continuous')) {
            track.applyConstraints({
              advanced: [{ exposureMode: 'continuous' } as MediaTrackConstraintSet],
            } as MediaTrackConstraints).catch(() => {})
          }
        } catch { /* older browser — no extended camera API */ }
      })
      .catch((err) => {
        setError(typeof err === 'string' ? err : (err as Error).message ?? 'Camera not available')
      })

    return () => {
      activeRef.current  = false
      trackRef.current   = null
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
    activeRef.current  = false
    trackRef.current   = null
    const s = scannerRef.current
    scannerRef.current = null
    if (s) {
      s.stop()
        .then(() => { try { s.clear() } catch {} })
        .catch(() => { try { s.clear() } catch {} })
    }
    onCloseRef.current()
  }

  function handleZoomIn() {
    if (!zoomRange) return
    applyZoom(zoom + (zoomRange.max - zoomRange.min) * 0.1)
  }

  function handleZoomOut() {
    if (!zoomRange) return
    applyZoom(zoom - (zoomRange.max - zoomRange.min) * 0.1)
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

      {/* Controls — zoom (if supported) + torch (if supported) */}
      {(zoomRange || torchSupported) && (
        <div className="flex items-center justify-center gap-3 pb-2">
          {zoomRange && (
            <>
              <button
                onClick={handleZoomOut}
                disabled={zoom <= zoomRange.min}
                className="p-2.5 rounded-full bg-white/10 text-white disabled:opacity-30 active:bg-white/20"
              >
                <ZoomOut size={20} />
              </button>
              <span className="text-xs text-white/60 w-12 text-center font-mono">
                {zoom.toFixed(1)}x
              </span>
              <button
                onClick={handleZoomIn}
                disabled={zoom >= zoomRange.max}
                className="p-2.5 rounded-full bg-white/10 text-white disabled:opacity-30 active:bg-white/20"
              >
                <ZoomIn size={20} />
              </button>
            </>
          )}
          {torchSupported && (
            <button
              onClick={handleTorch}
              className={`p-2.5 rounded-full text-white active:bg-white/20 transition-colors ${
                torch ? 'bg-yellow-500/50' : 'bg-white/10'
              }`}
              title={torch ? 'Turn off torch' : 'Turn on torch'}
            >
              {torch
                ? <Zap size={20} className="text-yellow-300" />
                : <ZapOff size={20} />
              }
            </button>
          )}
        </div>
      )}

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
          <p className="text-xs text-white/50">
            {torchSupported
              ? 'Align barcode in frame — tap ⚡ for low light'
              : 'Align barcode in frame — use zoom for distance'}
          </p>
          <p className="text-[10px] text-white/30">EAN-13 · UPC-A · EAN-8 · UPC-E · Code 128</p>
        </div>
      )}
    </div>
  )
}
