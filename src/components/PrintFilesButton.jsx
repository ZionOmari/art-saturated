import { useState } from 'react'

// Admin: builds an order's print files and downloads them as one zip.
export default function PrintFilesButton({ order }) {
  const [status, setStatus] = useState('')
  const [error,  setError]  = useState('')

  async function run() {
    setError(''); setStatus('Starting…')
    try {
      const { buildPrintPackage, saveBlob } = await import('../lib/cdPrintFiles')
      const { blob, filename } = await buildPrintPackage(order, setStatus)
      saveBlob(blob, filename)
    } catch (err) {
      setError(err.message || 'Could not build the print files.')
    } finally {
      setStatus('')
    }
  }

  return (
    <div>
      <button type="button" onClick={run} disabled={!!status} className="btn-outline text-[10px]">
        {status || 'Download print files'}
      </button>
      {error && <p role="alert" className="font-mono text-[11px] mt-1" style={{ color: '#b03020' }}>{error}</p>}
    </div>
  )
}
