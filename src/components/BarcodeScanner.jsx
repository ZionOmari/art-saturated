import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'

// In-browser barcode scanner using ZXing.
// Works on iOS Safari (canvas-based decode, no native BarcodeDetector needed).
// Calls onDetect(value) on first successful read, onClose() on cancel.
export default function BarcodeScanner({ onDetect, onClose }) {
  const videoRef    = useRef(null)
  const controlsRef = useRef(null)
  const [status, setStatus] = useState('starting') // 'starting' | 'scanning' | 'error'
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    let done = false
    const reader = new BrowserMultiFormatReader()

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (result, err, controls) => {
          if (done) return
          if (!controlsRef.current) {
            controlsRef.current = controls
            setStatus('scanning')
          }
          if (result) {
            done = true
            controls.stop()
            onDetect(result.getText())
          }
          // NotFoundException fires constantly between frames — ignore it
          if (err && err.name !== 'NotFoundException') {
            setErrMsg(err.message || 'Camera error')
            setStatus('error')
          }
        }
      )
      .catch(err => {
        if (!done) {
          setErrMsg(err.message || 'Camera access denied — check permissions')
          setStatus('error')
        }
      })

    return () => {
      done = true
      controlsRef.current?.stop()
    }
  }, [])

  function close() {
    controlsRef.current?.stop()
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div style={{ width: '100%', maxWidth: '400px', background: '#18150e', border: '1px solid #3a3630', display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #2e2a24' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#8a8ac0' }}>
            Scan Barcode
          </span>
          <button
            onClick={close}
            style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a6a5a', background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            ✕ Close
          </button>
        </div>

        {/* Viewfinder */}
        <div style={{ position: 'relative', background: '#000', aspectRatio: '1 / 1', overflow: 'hidden' }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

          {/* Aim box */}
          <div style={{ position: 'absolute', inset: '22%', border: '2px solid rgba(90,90,180,0.75)', pointerEvents: 'none' }}>
            {/* Corner accents */}
            <div style={{ position: 'absolute', top: -2, left: -2, width: 14, height: 14, borderTop: '2px solid #8a8ae8', borderLeft: '2px solid #8a8ae8' }} />
            <div style={{ position: 'absolute', top: -2, right: -2, width: 14, height: 14, borderTop: '2px solid #8a8ae8', borderRight: '2px solid #8a8ae8' }} />
            <div style={{ position: 'absolute', bottom: -2, left: -2, width: 14, height: 14, borderBottom: '2px solid #8a8ae8', borderLeft: '2px solid #8a8ae8' }} />
            <div style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderBottom: '2px solid #8a8ae8', borderRight: '2px solid #8a8ae8' }} />
          </div>

          {status === 'starting' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#c8c0b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Starting camera…</span>
            </div>
          )}
        </div>

        {/* Status */}
        <div style={{ padding: '10px 14px', minHeight: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {status === 'error' ? (
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d05050', margin: 0, textAlign: 'center' }}>{errMsg}</p>
          ) : (
            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#5a5040', margin: 0, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {status === 'starting' ? 'Requesting camera…' : 'Hold barcode in frame'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
