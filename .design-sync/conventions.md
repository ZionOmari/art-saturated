## Art Saturated — building with this design system

These are the real `art-saturated` storefront components (a Fort Wayne art shop & marketplace). Plain React, all on `window.ArtSaturated.*`. The look is warm and editorial: a coffee‑cream palette, **Playfair Display** serif headings, **DM Mono** for everything else.

### Setup — wrap the tree
Most components use React Router (`useNavigate`/`NavLink`); a few read theme/cart/auth context. The bundle exports the providers — wrap your app once:

```jsx
const { MemoryRouter, ThemeProvider, CartProvider, AuthProvider } = window.ArtSaturated
<MemoryRouter>
  <ThemeProvider>     {/* sets data-theme; enables dark mode + brand tokens */}
    <CartProvider>    {/* drives the Navbar cart count */}
      <AuthProvider>  {/* only needed for Navbar / ProfileAvatar */}
        {/* your screen */}
      </AuthProvider>
    </CartProvider>
  </ThemeProvider>
</MemoryRouter>
```

Firebase is stubbed inert in this bundle, so auth, cart persistence, and data fetches are no‑ops — components render logged‑out and empty. Drive content through **props**: `ProductCard product={…}`, `ProductGrid products={[…]}`, `EnigmaPreorderSpotlight title/artist/price`. `ArtCarousel` self‑fetches live art and renders nothing without a backend — skip it in mockups.

### Styling idiom — Tailwind preset + brand tokens
Style with the project's Tailwind classes, not ad‑hoc CSS. Brand families (all opacity‑modifiable, e.g. `bg-ink/5`):

| Kind | Vocabulary |
|---|---|
| Color | `cream` `paper` `ink` `warm-gray` `warm-gray-light` `earth` `earth-light` `offwhite` → as `bg-*` / `text-*` / `border-*` |
| Font | `font-serif` (Playfair — headings) · `font-mono` (DM Mono — labels, prices, UI) |
| Pieces | `eyebrow` (tiny mono‑caps label) · `btn-outline` · `btn-ghost` · `filter-pill` / `filter-pill-active` · `divider` · `gradient-text` (gold gradient heading) · `text-box-dark` |

Idiom: eyebrows and labels are `font-mono uppercase tracking-[0.1em–0.2em] text-[10–12px]`; titles are `font-serif`; body text is mono. **Dark mode** = set `data-theme="dark"` on a root element (the ThemeProvider toggle does this); every `--color-*` token flips automatically.

### Where the truth lives
Read the bundle's `styles.css` (it imports the compiled Tailwind + the `--color-*` tokens) before styling, and each component's `.prompt.md` / `.d.ts` for its exact props.

### Example
```jsx
const { ProductGrid } = window.ArtSaturated
<section className="bg-cream px-6 py-12">
  <p className="eyebrow mb-2">New this week</p>
  <h2 className="font-serif text-2xl gradient-text mb-6">Fresh from the studio</h2>
  <ProductGrid products={items} />
</section>
```
