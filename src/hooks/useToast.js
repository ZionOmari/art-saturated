import { useState, useCallback } from 'react'

/**
 * useToast — lightweight notification hook
 *
 * Returns { toast, showToast }
 *   toast      → { visible: bool, message: string }
 *   showToast  → (message: string, duration?: ms) => void
 */
export function useToast() {
  const [toast, setToast] = useState({ visible: false, message: '' })

  const showToast = useCallback((message, duration = 2000) => {
    setToast({ visible: true, message })
    setTimeout(() => setToast({ visible: false, message: '' }), duration)
  }, [])

  return { toast, showToast }
}
