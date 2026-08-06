import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import { fetchArticleBySlug } from '../data/blog'
import { setPageMeta, resetPageMeta } from '../lib/meta'

function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function ArticlePage() {
  const { slug }   = useParams()
  const navigate   = useNavigate()
  const [article, setArticle] = useState(undefined)  // undefined = loading, null = not found

  useEffect(() => {
    fetchArticleBySlug(slug).then(setArticle).catch(() => setArticle(null))
  }, [slug])

  useEffect(() => {
    if (!article) return
    setPageMeta({
      title:       `${article.title} — Art Saturated Magazine`,
      description: article.metaDescription || article.excerpt || article.title,
      image:       article.coverURL || undefined,
      url:         `https://artsaturated.com/magazine/${article.slug || article.id}`,
    })
    return () => resetPageMeta()
  }, [article])

  if (article === undefined) {
    return (
      <main className="pt-[60px] flex items-center justify-center min-h-screen" style={{ background: 'rgb(var(--color-cream))' }}>
        <Spinner size={20} color="#3d2810" />
      </main>
    )
  }

  if (article === null) {
    return (
      <main className="pt-[60px] flex flex-col items-center justify-center min-h-screen px-6 gap-4" style={{ background: 'rgb(var(--color-cream))' }}>
        <p className="font-serif text-[2rem] font-normal text-ink">Article not found.</p>
        <button className="btn-outline" onClick={() => navigate('/magazine')}>← Back to Magazine</button>
      </main>
    )
  }

  const paragraphs = (article.body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  return (
    <main className="pt-[60px]" style={{ background: 'rgb(var(--color-cream))', minHeight: '100vh' }}>
      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <button
          onClick={() => navigate('/magazine')}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '28px' }}
        >
          ← Magazine
        </button>

        {article.category && <p className="eyebrow mb-3" style={{ color: '#a08060' }}>{article.category}</p>}

        <h1 className="font-serif text-[clamp(1.9rem,5vw,2.8rem)] font-normal leading-tight text-ink mb-4">
          {article.title}
        </h1>

        <p className="font-mono text-[11px] tracking-[0.1em] uppercase mb-8" style={{ color: '#a08060' }}>
          {article.authorName}{article.submittedAt ? ` · ${fmtDate(article.submittedAt)}` : ''}
        </p>

        {article.coverURL && (
          <img src={article.coverURL} alt={article.title}
            style={{ width: '100%', maxHeight: '420px', objectFit: 'cover', display: 'block', marginBottom: '32px', background: '#e8e0d4' }} />
        )}

        {article.excerpt && (
          <p className="font-serif italic text-[1.15rem] text-ink leading-relaxed pl-5 border-l-2 border-earth mb-8">
            {article.excerpt}
          </p>
        )}

        <div className="flex flex-col gap-5">
          {paragraphs.map((p, i) => {
            const isQuestionLabel = /^Question \d+$/i.test(p.trim())
            return (
              <p
                key={i}
                className="text-ink leading-[1.85]"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: '1.02rem',
                  fontWeight: isQuestionLabel ? 700 : 400,
                  marginTop: isQuestionLabel ? '1.25rem' : undefined,
                }}
              >
                {p}
              </p>
            )
          })}
        </div>
      </article>

      <Footer />
    </main>
  )
}
