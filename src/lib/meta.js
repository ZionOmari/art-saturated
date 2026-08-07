// ── Dynamic meta tag updater ──────────────────────────────────────────────────
// Updates <title> and OG/Twitter meta tags for the current page.
// Works for X/Twitter, Slack, and other platforms that execute JS before scraping.
// Facebook/LinkedIn require SSR for full support — static site fallbacks apply there.

const DEFAULTS = {
  title:       'Art Saturated',
  description: 'Creative Engineering. Cultural Architecture. Handmade physical media, original art, and upcycled objects — made in store.',
  image:       'https://artsaturated.com/og-image.jpg',
  url:         'https://artsaturated.com/',
}

// Social scrapers need an absolute og:image/twitter:image URL.
// Root-relative paths (e.g. "/banners/foo.jpg") are fine for <img src> but must
// be resolved against the production origin for sharing previews.
const SITE_ORIGIN = 'https://artsaturated.com'
function absolutize(url) {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) return url
  return SITE_ORIGIN + (url.startsWith('/') ? url : '/' + url)
}

// index.html ships a single hard-coded canonical pointing at the homepage. Left
// alone it tells Google every product, artist and page is a duplicate of "/",
// which is the strongest de-duplication signal there is — so keep it in step
// with the route. Query strings and hashes are ALWAYS stripped here, regardless
// of what a caller passes (some pass window.location.href): /shop?cat=Art is the
// same page as /shop as far as indexing is concerned, so they must share one
// canonical or the filtered views compete with each other in search.
function stripToCanonical(url) {
  try {
    const u = new URL(url, SITE_ORIGIN)
    return u.origin + u.pathname
  } catch {
    return url
  }
}

function setCanonical(href) {
  let el = document.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', stripToCanonical(href))
}

function setMeta(property, content) {
  let el = document.querySelector(`meta[property="${property}"]`)
    || document.querySelector(`meta[name="${property}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(property.startsWith('og:') || property.startsWith('twitter:') ? 'property' : 'name', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export function setPageMeta({ title, description, image, url }) {
  const t = title       || DEFAULTS.title
  const d = description || DEFAULTS.description
  const i = absolutize(image) || DEFAULTS.image
  const u = url         || (SITE_ORIGIN + window.location.pathname)

  document.title = t
  setCanonical(u)

  setMeta('og:title',       t)
  setMeta('og:description', d)
  setMeta('og:image',       i)
  setMeta('og:url',         u)
  setMeta('og:type',        'product')

  setMeta('twitter:title',       t)
  setMeta('twitter:description', d)
  setMeta('twitter:image',       i)
  setMeta('twitter:card',        'summary_large_image')

  setMeta('description', d)
}

// Called on every route change so a page that never sets its own meta still gets
// a correct canonical. Pages that DO call setPageMeta refine it afterwards.
export function setCanonicalForRoute(pathname) {
  setCanonical(SITE_ORIGIN + pathname)
}

export function resetPageMeta() {
  document.title = DEFAULTS.title
  // Pages without their own meta still deserve their own canonical — resetting
  // to DEFAULTS.url here would recreate the every-page-is-the-homepage problem.
  setCanonical(SITE_ORIGIN + window.location.pathname)
  setMeta('og:title',       DEFAULTS.title)
  setMeta('og:description', DEFAULTS.description)
  setMeta('og:image',       DEFAULTS.image)
  setMeta('og:url',         DEFAULTS.url)
  setMeta('og:type',        'website')
  setMeta('twitter:title',       DEFAULTS.title)
  setMeta('twitter:description', DEFAULTS.description)
  setMeta('twitter:image',       DEFAULTS.image)
  setMeta('description',   DEFAULTS.description)
}
