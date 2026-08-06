import { createContext, useContext, useReducer, useEffect, useMemo, useCallback } from 'react'

// ─── State shape ─────────────────────────────────────────────────────────────
// cart: Array<{ id, name, price, emoji, slug, imageURL, weightOz, stock, qty }>
// stock = available inventory (null/'' = unlimited)
// qty   = units currently in cart

const CartContext = createContext(null)
const STORAGE_KEY = 'art-saturated-cart'

// Returns max purchasable qty for an item (Infinity if unlimited)
function stockOf(item) {
  if (item.unique || item.isOriginal) return 1
  const s = Number(item.stock)
  return (item.stock != null && item.stock !== '' && !isNaN(s)) ? s : Infinity
}

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.find((i) => i.id === action.product.id)
      const maxQty   = stockOf(action.product)
      if (existing) {
        return state.map((i) =>
          i.id === action.product.id
            ? { ...i, qty: Math.min(i.qty + 1, maxQty) }
            : i
        )
      }
      return [...state, { ...action.product, qty: 1 }]
    }

    case 'REMOVE_ITEM':
      return state.filter((i) => i.id !== action.id)

    case 'UPDATE_QTY': {
      const updated = state.map((i) => {
        if (i.id !== action.id) return i
        const maxQty = stockOf(i)
        return { ...i, qty: Math.min(Math.max(0, i.qty + action.delta), maxQty) }
      })
      return updated.filter((i) => i.qty > 0)
    }

    case 'CLEAR_CART':
      return []

    case 'HYDRATE':
      return action.cart

    default:
      return state
  }
}

// ─── Load saved cart from localStorage ───────────────────────────────────────
function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────
export function CartProvider({ children }) {
  const [cart, dispatch] = useReducer(cartReducer, [], loadCart)

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
    } catch {
      // storage quota exceeded or private browsing — fail silently
    }
  }, [cart])

  const addToCart      = useCallback((product)   => dispatch({ type: 'ADD_ITEM', product }), [])
  const removeFromCart = useCallback((id)        => dispatch({ type: 'REMOVE_ITEM', id }), [])
  const updateQty      = useCallback((id, delta) => dispatch({ type: 'UPDATE_QTY', id, delta }), [])
  const clearCart      = useCallback(()          => dispatch({ type: 'CLEAR_CART' }), [])
  const hydrateCart    = useCallback((items)     => dispatch({ type: 'HYDRATE', cart: items }), [])

  // Memoized so the context value only changes when the cart changes — prevents every
  // consumer (Navbar, pages) from re-rendering on unrelated parent renders.
  const value = useMemo(() => {
    const cartCount = cart.reduce((sum, i) => sum + i.qty, 0)
    const cartTotal = cart.reduce((sum, i) => sum + i.qty * Number(i.price || 0), 0)
    // Returns true if the item is already at its stock limit in the cart
    const atMax = (productId) => {
      const item = cart.find(i => i.id === productId)
      return item ? item.qty >= stockOf(item) : false
    }
    return { cart, cartCount, cartTotal, addToCart, removeFromCart, updateQty, clearCart, atMax, hydrateCart }
  }, [cart, addToCart, removeFromCart, updateQty, clearCart, hydrateCart])

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
