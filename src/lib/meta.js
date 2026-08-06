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
  const u = url         || window.location.href

  document.title = t

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

export function resetPageMeta() {
  document.title = DEFAULTS.title
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
