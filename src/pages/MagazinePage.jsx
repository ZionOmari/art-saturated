import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import { fetchPublishedArticles } from '../data/blog'
import { setPageMeta, resetPageMeta } from '../lib/meta'

function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function MagazinePage() {
  const navigate = useNavigate()
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    setPageMeta({
      title:       'Magazine — Art Saturated',
      description: 'Stories on art, music, and culture from Fort Wayne and the independent creative community.',
      url:         'https://artsaturated.com/magazine',
    })
    return () => resetPageMeta()
  }, [])

  useEffect(() => {
    fetchPublishedArticles().then(setArticles).catch(() => setArticles([])).finally(() => setLoading(false))
  }, [])

  return (
    <main className="pt-[60px]" style={{ background: 'rgb(var(--color-cream))', minHeight: '100vh' }}>
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-8 border-b border-warm-gray-light">
        <p className="eyebrow mb-3">Art Saturated</p>
        <h1 className="font-serif text-[clamp(2.2rem,6vw,3.4rem)] font-normal leading-tight text-ink">Magazine</h1>
        <p className="font-mono text-[12px] text-warm-gray mt-4 max-w-xl leading-relaxed">
          Stories on art, music, and culture from Fort Wayne and the independent creative community.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-12 pb-24">
        {loading ? (
          <Spinner size={20} color="#3d2810" />
        ) : articles.length === 0 ? (
          <p className="font-mono text-[13px] text-warm-gray">No articles published yet — check back soon.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-12">
            {articles.map(a => (
              <article
                key={a.id}
                onClick={() => navigate(`/magazine/${a.slug || a.id}`)}
                className="group cursor-pointer"
              >
                <div style={{ aspectRatio: '16/10', overflow: 'hidden', background: '#e8e0d4', marginBottom: '14px' }}>
                  {a.coverURL
                    ? <img src={a.coverURL} alt={a.title} loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.3s' }}
                        className="group-hover:scale-[1.03]" />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', color: '#c5bfb5' }}>✶</div>
                  }
                </div>
                {a.category && <p className="eyebrow mb-2" style={{ color: '#a08060' }}>{a.category}</p>}
                <h2 className="font-serif text-[1.3rem] font-normal leading-snug text-ink group-hover:opacity-70 transition-opacity">
                  {a.title}
                </h2>
                {a.excerpt && (
                  <p className="font-mono text-[12px] text-warm-gray mt-2 leading-relaxed">
                    {a.excerpt.slice(0, 140)}{a.excerpt.length > 140 ? '…' : ''}
                  </p>
                )}
                <p className="font-mono text-[10px] tracking-[0.1em] uppercase mt-3" style={{ color: '#a08060' }}>
                  {a.authorName}{a.submittedAt ? ` · ${fmtDate(a.submittedAt)}` : ''}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  )
}
