import { useRef, useState, useEffect } from 'react'

/**
 * Track preview player for a product listing.
 *
 * Takes `tracks`: [{ title, url }]. Only one track plays at a time — selecting
 * another stops the current one, which is what you want on an album page.
 * Renders nothing when there are no tracks, so it is safe to drop into any
 * product page unconditionally.
 */
export default function AudioPreview({ tracks = [] }) {
  const audioRef = useRef(null)
  const [current, setCurrent] = useState(null)   // index of the loaded track
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)    // 0–1
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState(null)

  // Pause on unmount so audio never outlives the page.
  useEffect(() => () => { audioRef.current?.pause() }, [])

  if (!tracks.length) return null

  async function select(i) {
    const audio = audioRef.current
    if (!audio) return
    setError(null)

    if (current === i) {
      if (audio.paused) { try { await audio.play() } catch { /* ignore */ } }
      else audio.pause()
      return
    }

    audio.pause()
    setCurrent(i)
    setProgress(0)
    audio.src = tracks[i].url
    try {
      await audio.play()
    } catch {
      // Autoplay policies can reject a play() that wasn't user-driven enough;
      // the track is loaded either way, so just surface the paused state.
      setPlaying(false)
    }
  }

  function scrub(e) {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const fmt = (s) => {
    if (!Number.isFinite(s)) return '0:00'
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  return (
    <section className="mt-8" aria-label="Track previews">
      <p className="eyebrow mb-4">Preview</p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {tracks.map((t, i) => {
          const active = current === i
          return (
            <li
              key={t.url || i}
              style={{
                borderTop: '1px solid rgb(var(--color-warm-gray-light))',
                ...(i === tracks.length - 1
                  ? { borderBottom: '1px solid rgb(var(--color-warm-gray-light))' }
                  : {}),
              }}
            >
              <button
                type="button"
                onClick={() => select(i)}
                aria-label={`${active && playing ? 'Pause' : 'Play'} ${t.title || `Track ${i + 1}`}`}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '12px 4px', background: 'none', border: 0, cursor: 'pointer',
                  textAlign: 'left', color: 'inherit',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 26, height: 26, flexShrink: 0, borderRadius: '50%',
                    border: '1px solid rgb(var(--color-ink))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, lineHeight: 1,
                    background: active ? 'rgb(var(--color-ink))' : 'transparent',
                    color: active ? 'rgb(var(--color-cream))' : 'rgb(var(--color-ink))',
                  }}
                >
                  {active && playing ? '❚❚' : '▶'}
                </span>

                <span className="font-mono text-[13px] flex-1" style={{ color: 'rgb(var(--color-ink))' }}>
                  {t.title || `Track ${i + 1}`}
                </span>

                {active && duration > 0 && (
                  <span className="font-mono text-[11px] text-warm-gray">
                    {fmt(progress * duration)} / {fmt(duration)}
                  </span>
                )}
              </button>

              {active && (
                <div
                  onClick={scrub}
                  role="progressbar"
                  aria-label="Seek"
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  style={{
                    height: 3, margin: '0 4px 12px', cursor: 'pointer',
                    background: 'rgb(var(--color-warm-gray-light))',
                  }}
                >
                  <div style={{
                    width: `${progress * 100}%`, height: '100%',
                    background: 'rgb(var(--color-earth))', transition: 'width 0.1s linear',
                  }} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="font-mono text-[11px] mt-3" style={{ color: '#b94040' }}>{error}</p>
      )}

      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onTimeUpdate={e => {
          const d = e.currentTarget.duration
          if (d) setProgress(e.currentTarget.currentTime / d)
        }}
        onError={() => { setError('That track could not be loaded.'); setPlaying(false) }}
      />
    </section>
  )
}
