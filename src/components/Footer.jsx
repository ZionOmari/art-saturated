import { useNavigate } from 'react-router-dom'

export default function Footer() {
  const navigate = useNavigate()

  return (
    <footer className="mt-24 border-t border-warm-gray-light px-6 py-8 flex flex-wrap items-center justify-between gap-4">
      <span className="gradient-text" style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' }}>Art Saturated</span>

      <nav className="flex gap-6 flex-wrap">
        {[
          { label: 'Shop',          path: '/shop'    },
          { label: 'Consultations', path: '/consult' },
          { label: 'CD Printing',   path: '/cd-printing' },
          { label: 'About',         path: '/about'   },
          { label: 'Cart',          path: '/cart'    },
        ].map(({ label, path }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray
                       bg-transparent border-0 cursor-pointer transition-colors hover:text-ink
                       py-2 px-1"
          >
            {label}
          </button>
        ))}
      </nav>

      <p className="font-mono text-[11px] text-warm-gray tracking-wide">
        © {new Date().getFullYear()} Art Saturated · Made by hand
      </p>
    </footer>
  )
}
