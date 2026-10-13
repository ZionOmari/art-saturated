// Build-time sitemap generator.
// Enriches dist/sitemap.xml with every active product, public artist, and
// published article so new pages get indexed automatically. Fully resilient:
// any failure leaves the static public/sitemap.xml in place and exits 0, so a
// sitemap hiccup can NEVER break a deploy.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://artsaturated.com'

// Only live routes belong here. /artists, /magazine, /events, /book and
// /submit-art were retired in Aug 2026 and now redirect — advertising them to
// search engines would just feed crawlers into redirects.
const CORE = [
  ['/',         '1.0', 'weekly'],
  ['/shop',     '0.9', 'daily'],
  ['/consult',  '0.8', 'monthly'],
  ['/cd-printing', '0.8', 'monthly'],
  ['/about',    '0.7', 'monthly'],
]

const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function urlTag(path, priority, changefreq) {
  return `  <url><loc>${ORIGIN}${xmlEscape(path)}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`
}

function writeSitemap(urls) {
  const body = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls, '</urlset>', ''].join('\n')
  // Prefer dist (post-build); fall back to public so a dev run still works.
  const target = existsSync(join(ROOT, 'dist')) ? join(ROOT, 'dist', 'sitemap.xml') : join(ROOT, 'public', 'sitemap.xml')
  writeFileSync(target, body)
  return target
}

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return env
}

async function main() {
  const urls = CORE.map(([p, pr, cf]) => urlTag(p, pr, cf))
  try {
    const env = loadEnv()
    const config = {
      apiKey:     env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId:  env.VITE_FIREBASE_PROJECT_ID,
      appId:      env.VITE_FIREBASE_APP_ID,
    }
    if (!config.projectId) throw new Error('no firebase config')

    const { initializeApp } = await import('firebase/app')
    const { getFirestore, collection, getDocs, query, where } = await import('firebase/firestore')
    const app = initializeApp(config)
    const db  = getFirestore(app)

    // Products → /shop/:slug
    const prodSnap = await getDocs(collection(db, 'products'))
    prodSnap.forEach(d => {
      const p = d.data()
      if (p.active === false || p.inBucket || p.inCollection || p.category === 'Mystery' || !p.slug) return
      urls.push(urlTag(`/shop/${p.slug}`, '0.7', 'weekly'))
    })

    // Public artists → /artists/:uid
    const artSnap = await getDocs(query(collection(db, 'users'), where('artistPublic', '==', true)))
    artSnap.forEach(d => urls.push(urlTag(`/artists/${d.id}`, '0.6', 'weekly')))

    // Approved articles → /magazine/:slug
    const artiSnap = await getDocs(query(collection(db, 'blogSubmissions'), where('status', '==', 'approved')))
    artiSnap.forEach(d => {
      const a = d.data()
      urls.push(urlTag(`/magazine/${a.slug || d.id}`, '0.6', 'monthly'))
    })

    const target = writeSitemap(urls)
    console.log(`[sitemap] wrote ${urls.length} URLs → ${target}`)
  } catch (err) {
    // Never block a deploy — keep the static sitemap and move on.
    console.warn(`[sitemap] dynamic generation skipped (${err.message}). Static sitemap kept.`)
    try { writeSitemap(urls) } catch {}
  }
}

main().finally(() => process.exit(0))
