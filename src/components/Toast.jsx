/**
 * Toast
 * Fixed bottom notification. Controlled via useToast hook.
 *
 * Props:
 *   message  – string to display
 *   visible  – boolean
 */
export default function Toast({ message, visible }) {
  return (
    <div
      aria-live="polite"
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200]
                  bg-ink text-offwhite font-mono text-[11px] tracking-[0.12em] uppercase
                  px-6 py-3 whitespace-nowrap pointer-events-none
                  transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {message}
    </div>
  )
}
