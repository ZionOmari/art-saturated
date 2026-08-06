// ── Shared Mystery Preferences UI ────────────────────────────────────────────
// Used by MysteryPage (crate builder step 2 + single mode)
// and AccountPage (Mystery Profile tab)

export const FORMAT_OPTIONS = [
  { value: 'Any',      label: 'Surprise Me' },
  { value: 'Vinyl',    label: 'Vinyl'       },
  { value: 'CD',       label: 'CD'          },
  { value: 'Cassette', label: 'Cassette'    },
  { value: '8-Track',  label: '8-Track'     },
]

export const DECADE_OPTIONS = [
  { value: 'Any',     label: 'Any Era'   },
  { value: '60s-70s', label: '60s – 70s' },
  { value: '80s-90s', label: '80s – 90s' },
  { value: '2000s+',  label: '2000s+'    },
]

export const ALL_GENRES = [
  'Jazz', 'Soul', 'R&B', 'Funk', 'Blues', 'Gospel',
  'Hip-Hop', 'Rap', 'Lo-Fi', 'Boom Bap',
  'Rock', 'Punk', 'Indie', 'Alt Rock', 'Metal', 'Folk',
  'Electronic', 'Dance', 'Ambient', 'Experimental',
  'Classical', 'Country', 'World', 'Reggae', 'Dub',
  'Pop', 'Soundtrack', 'New Age',
]

export const DEFAULT_MYSTERY_PREFS = {
  format: 'Any',
  decade: 'Any',
  scale:  50,   // 0 = haul mode, 100 = curated/quality
  jacket: 50,   // 0 = no jacket required, 100 = pristine sleeve
  media:  50,   // 0 = any condition, 100 = near mint
  genres: {},   // { Jazz: 1, Metal: 2 } — 1=love, 2=skip
}

// ── Label helpers ─────────────────────────────────────────────────────────────

export function scaleLabel(v) {
  if (v <= 25) return 'More is more — haul mode'
  if (v <= 50) return 'Mix of quantity + quality'
  if (v <= 75) return 'Quality over quantity'
  return 'Fewer, premium picks only'
}

export function jacketLabel(v) {
  if (v <= 25) return 'No jacket required'
  if (v <= 50) return 'Jacket nice but not required'
  if (v <= 75) return 'Good condition sleeve please'
  return 'Pristine sleeve required'
}

export function mediaLabel(v) {
  if (v <= 25) return 'Any playable condition'
  if (v <= 50) return 'Good+ (light surface noise OK)'
  if (v <= 75) return 'VG+ or better'
  return 'Near Mint — no exceptions'
}

export function formatPrefsNote(prefs) {
  const parts = [
    `Scale: ${scaleLabel(prefs.scale ?? 50)}`,
    `Jacket: ${jacketLabel(prefs.jacket ?? 50)}`,
    `Media: ${mediaLabel(prefs.media ?? 50)}`,
  ]
  if (prefs.format && prefs.format !== 'Any') parts.push(`Format: ${prefs.format}`)
  if (prefs.decade && prefs.decade !== 'Any') parts.push(`Era: ${prefs.decade}`)

  const g      = prefs.genres || {}
  const loved  = Object.entries(g).filter(([, v]) => v === 1).map(([k]) => k)
  const skipped = Object.entries(g).filter(([, v]) => v === 2).map(([k]) => k)
  if (loved.length)   parts.push(`Loves: ${loved.join(', ')}`)
  if (skipped.length) parts.push(`Skip: ${skipped.join(', ')}`)

  return parts.join(' · ')
}

// ── UI components ─────────────────────────────────────────────────────────────

export function PrefPill({ value, selected, onSelect, children }) {
  return (
    <button
      onClick={() => onSelect(value)}
      className={`font-mono text-[11px] tracking-[0.08em] uppercase px-3.5 py-2 border transition-all duration-150 cursor-pointer ${
        selected
          ? 'border-ink bg-ink text-cream'
          : 'border-warm-gray-light text-warm-gray hover:border-ink hover:text-ink bg-transparent'
      }`}
    >
      {children}
    </button>
  )
}

export function VibeSlider({ label, left, right, value, onChange, getLabel }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-warm-gray shrink-0">{label}</span>
        <span className="font-mono text-[10px] text-ink text-right leading-tight">{getLabel(value)}</span>
      </div>
      <input
        type="range"
        min={0} max={100} step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: '#1a1208' }}
      />
      <div className="flex justify-between">
        <span className="font-mono text-[9px] text-warm-gray/55">{left}</span>
        <span className="font-mono text-[9px] text-warm-gray/55">{right}</span>
      </div>
    </div>
  )
}

export function GenreGrid({ genres, onChange }) {
  function cycle(g) {
    const cur  = genres[g] ?? 0
    const next = cur === 0 ? 1 : cur === 1 ? 2 : 0
    const updated = { ...genres }
    if (next === 0) delete updated[g]; else updated[g] = next
    onChange(updated)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {ALL_GENRES.map(g => {
          const state = genres[g] ?? 0
          return (
            <button
              key={g}
              onClick={() => cycle(g)}
              title={state === 0 ? 'Click to love' : state === 1 ? 'Click to skip' : 'Click to reset'}
              className={`font-mono text-[10px] px-2.5 py-1.5 border transition-all duration-150 cursor-pointer ${
                state === 1
                  ? 'border-ink bg-ink text-cream'
                  : state === 2
                  ? 'border-warm-gray-light/30 text-warm-gray/30 line-through bg-transparent'
                  : 'border-warm-gray-light text-warm-gray hover:border-ink hover:text-ink bg-transparent'
              }`}
            >
              {state === 1 ? '♥ ' : ''}{g}
            </button>
          )
        })}
      </div>
      <p className="font-mono text-[9px] text-warm-gray/50 leading-relaxed">
        Tap once to ♥ love · Tap again to skip · Tap again to reset
      </p>
    </div>
  )
}

// ── Full panel (scale + condition + genres + format + era) ───────────────────

export default function MysteryPreferencesPanel({ prefs, onChange, showScale = true }) {
  function set(key, val) { onChange({ ...prefs, [key]: val }) }

  return (
    <div className="space-y-8">
      {showScale && (
        <div>
          <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-gray mb-4">Scale</p>
          <VibeSlider
            label="Quantity vs Quality"
            left="Haul Mode"
            right="Curated Picks"
            value={prefs.scale ?? 50}
            onChange={v => set('scale', v)}
            getLabel={scaleLabel}
          />
        </div>
      )}

      <div>
        <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-gray mb-4">Condition</p>
        <div className="space-y-5">
          <VibeSlider
            label="Jacket / Sleeve"
            left="No Jacket Fine"
            right="Pristine Sleeve"
            value={prefs.jacket ?? 50}
            onChange={v => set('jacket', v)}
            getLabel={jacketLabel}
          />
          <VibeSlider
            label="Media Quality"
            left="Any Condition"
            right="Near Mint"
            value={prefs.media ?? 50}
            onChange={v => set('media', v)}
            getLabel={mediaLabel}
          />
        </div>
      </div>

      <div>
        <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-gray mb-3">Genre Preferences</p>
        <GenreGrid genres={prefs.genres ?? {}} onChange={v => set('genres', v)} />
      </div>

      <div>
        <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-gray mb-3">Format</p>
        <div className="flex flex-wrap gap-2">
          {FORMAT_OPTIONS.map(o => (
            <PrefPill key={o.value} value={o.value} selected={(prefs.format ?? 'Any') === o.value} onSelect={v => set('format', v)}>
              {o.label}
            </PrefPill>
          ))}
        </div>
      </div>

      <div>
        <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-gray mb-3">Era</p>
        <div className="flex flex-wrap gap-2">
          {DECADE_OPTIONS.map(o => (
            <PrefPill key={o.value} value={o.value} selected={(prefs.decade ?? 'Any') === o.value} onSelect={v => set('decade', v)}>
              {o.label}
            </PrefPill>
          ))}
        </div>
      </div>
    </div>
  )
}
