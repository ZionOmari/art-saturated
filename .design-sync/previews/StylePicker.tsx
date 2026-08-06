import { useState } from 'react'
import { StylePicker } from 'art-saturated'

// StylePicker is a controlled multi-select of art styles with a free-text
// "add your own" field. Selected chips invert to the ink fill. Each story owns
// its selection state so the selected look is visible in the static capture.

export const Default = () => {
  const [selected, setSelected] = useState(['Afro Futurism', 'Surrealism'])
  return (
    <div style={{ width: 440, padding: 20 }}>
      <StylePicker selected={selected} onChange={setSelected} />
    </div>
  )
}

export const Empty = () => {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <div style={{ width: 440, padding: 20 }}>
      <StylePicker selected={selected} onChange={setSelected} />
    </div>
  )
}

export const WithCustomStyles = () => {
  const [selected, setSelected] = useState(['Portraiture', 'Linocut', 'Mixed Media'])
  return (
    <div style={{ width: 440, padding: 20 }}>
      <StylePicker selected={selected} onChange={setSelected} />
    </div>
  )
}
