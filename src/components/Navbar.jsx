import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

export default function Navbar() {
  const { cartCount } = useCart()
  const { user, logOut } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => { setOpen(false) }, [location.pathname])

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  async function handleLogout() {
    await logOut()
    navigate('/login')
  }

  const linkClass = ({ isActive }) =>
    `font-mono text-[10px] tracking-[0.12em] uppercase transition-colors duration-200 border px-3 py-1.5 ${
      isActive ? 'border-ink text-ink bg-ink/5' : 'border-warm-gray-light text-warm-gray hover:border-ink hover:text-ink'
    }`

  const drawerLinkClass = ({ isActive }) =>
    `font-mono text-[12px] tracking-[0.15em] uppercase py-3 px-3 border transition-colors duration-200 block my-1 ${
      isActive ? 'border-ink text-ink bg-ink/5' : 'border-warm-gray-light text-warm-gray'
    }`

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-[60px] bg-cream border-b border-warm-gray-light px-6 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/home')}
            className="gradient-text"
            style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.01em', border: 0, cursor: 'pointer', padding: 0, textAlign: 'left', display: 'block' }}
          >
            Art Saturated
          </button>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', color: '#b97a30', border: '1px solid #b97a30', padding: '2px 5px', lineHeight: 1, userSelect: 'none' }}>
            BETA
          </span>
        </div>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-8">
          <NavLink to="/home" className={linkClass}>Home</NavLink>
          <NavLink to="/shop" className={linkClass}>Shop</NavLink>
          <NavLink to="/consult" className={linkClass}>Consultations</NavLink>
          <NavLink to="/about" className={linkClass}>About</NavLink>
          {user ? (
            <NavLink to="/account" className={linkClass}>Account</NavLink>
          ) : (
            <NavLink to="/login" state={{ from: location.pathname }} className={linkClass}>Sign In</NavLink>
          )}
          {user && (
            <button onClick={handleLogout}
              className="font-mono text-[11px] tracking-[0.12em] uppercase transition-colors duration-200 text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer">
              Sign Out
            </button>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="font-mono text-[16px] leading-none bg-transparent border-0 cursor-pointer text-warm-gray hover:text-ink transition-colors duration-200"
            style={{ padding: '4px 2px' }}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀' : '☾'}
          </button>

          <button onClick={() => navigate('/cart')}
            className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] uppercase border border-ink px-4 py-1.5 text-ink bg-transparent cursor-pointer transition-all duration-200 hover:bg-ink hover:text-offwhite">
            Cart
            {cartCount > 0 && (
              <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-earth text-offwhite text-[10px]">
                {cartCount}
              </span>
            )}
          </button>
        </nav>

        {/* Mobile right side — theme toggle + cart + hamburger */}
        <div className="flex md:hidden items-center gap-3">
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="font-mono text-[16px] leading-none bg-transparent border-0 cursor-pointer text-warm-gray"
            style={{ padding: '4px 2px' }}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀' : '☾'}
          </button>
          <button onClick={() => navigate('/cart')}
            className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] uppercase border border-ink px-3 py-1.5 text-ink bg-transparent cursor-pointer">
            Cart
            {cartCount > 0 && (
              <span className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-earth text-offwhite text-[9px]">
                {cartCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center justify-center w-[44px] h-[44px] bg-transparent border-0 cursor-pointer -mr-2"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            <div className="flex flex-col justify-center gap-[5px] w-[24px]">
              <span className={`block h-[1.5px] bg-ink transition-all duration-200 ${open ? 'rotate-45 translate-y-[6.5px]' : ''}`} />
              <span className={`block h-[1.5px] bg-ink transition-all duration-200 ${open ? 'opacity-0' : ''}`} />
              <span className={`block h-[1.5px] bg-ink transition-all duration-200 ${open ? '-rotate-45 -translate-y-[6.5px]' : ''}`} />
            </div>
          </button>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div className={`fixed top-[60px] right-0 bottom-0 z-40 w-[280px] bg-cream border-l border-warm-gray-light px-6 pt-6 pb-10 flex flex-col transition-transform duration-300 md:hidden ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <nav aria-label="Mobile navigation" className="flex flex-col flex-1">
          <NavLink to="/home" className={drawerLinkClass}>Home</NavLink>
          <NavLink to="/shop" className={drawerLinkClass}>Shop</NavLink>
          <NavLink to="/consult" className={drawerLinkClass}>Consultations</NavLink>
          <NavLink to="/about" className={drawerLinkClass}>About</NavLink>
          {user ? (
            <NavLink to="/account" className={drawerLinkClass}>Account</NavLink>
          ) : (
            <NavLink to="/login" state={{ from: location.pathname }} className={drawerLinkClass}>Sign In</NavLink>
          )}
        </nav>

        {user && (
          <button onClick={handleLogout}
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-warm-gray hover:text-ink transition-colors bg-transparent border-0 cursor-pointer text-left mt-4">
            Sign Out
          </button>
        )}
      </div>
    </>
  )
}
