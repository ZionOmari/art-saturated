import { useState } from 'react'

export const ART_STYLES = [
  'Abstract', 'Contemporary', 'Afro Futurism', 'Surrealism', 'Portraiture',
  'Landscape', 'Street Art', 'Expressionism', 'Minimalism', 'Pop Art',
  'Impressionism', 'Realism',
]

export default function StylePicker({ selected = [], onChange }) {
  const [custom, setCustom] = useState('')

  function toggle(style) {
    onChange(selected.includes(style)
      ? selected.filter((s) => s !== style)
      : [...selected, style]
    )
  }

  function addCustom() {
    const val = custom.trim()
    if (!val || selected.includes(val)) return setCustom('')
    onChange([...selected, val])
    setCustom('')
  }

  const customSelected = selected.filter((s) => !ART_STYLES.includes(s))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', margin: 0 }}>
        Style / Genre
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {ART_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            style={{
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
              padding: '5px 12px', border: '1px solid', cursor: 'pointer',
              transition: 'all 0.15s',
              background: selected.includes(s) ? '#1a1208' : 'transparent',
              color: selected.includes(s) ? '#f5f0e8' : '#8a5c3a',
              borderColor: selected.includes(s) ? '#1a1208' : '#c8bfb0',
            }}
          >
            {s}
          </button>
        ))}
        {/* Custom styles already added */}
        {customSelected.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            style={{
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
              padding: '5px 12px', border: '1px solid #1a1208', cursor: 'pointer',
              background: '#1a1208', color: '#f5f0e8',
            }}
          >
            {s} ×
          </button>
        ))}
      </div>
      {/* Custom input */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
          style={{
            flex: 1, fontFamily: 'monospace', fontSize: '13px',
            padding: '10px 14px', border: '1px solid #d4c9bb',
            background: '#faf8f4', color: '#1a1208', outline: 'none',
          }}
          placeholder="Add your own style..."
        />
        <button
          type="button"
          onClick={addCustom}
          style={{
            fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
            padding: '10px 16px', border: '1px solid #c8bfb0', cursor: 'pointer',
            background: 'transparent', color: '#8a5c3a',
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}
