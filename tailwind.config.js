/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // All brand colors reference CSS variables so dark mode works automatically.
        // The <alpha-value> placeholder lets Tailwind opacity modifiers work (bg-ink/5 etc.)
        cream:             'rgb(var(--color-cream)       / <alpha-value>)',
        paper:             'rgb(var(--color-paper)       / <alpha-value>)',
        ink:               'rgb(var(--color-ink)         / <alpha-value>)',
        'warm-gray':       'rgb(var(--color-warm-gray)   / <alpha-value>)',
        'warm-gray-light': 'rgb(var(--color-warm-gray-light) / <alpha-value>)',
        earth:             'rgb(var(--color-earth)       / <alpha-value>)',
        'earth-light':     'rgb(var(--color-earth-light) / <alpha-value>)',
        offwhite:          'rgb(var(--color-offwhite)    / <alpha-value>)',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        mono:  ['"DM Mono"', '"Courier New"', 'monospace'],
      },
      letterSpacing: {
        widest2: '0.2em',
      },
    },
  },
  plugins: [],
}
