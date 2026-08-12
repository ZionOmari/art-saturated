import { useState, useRef, useEffect, useCallback } from 'react'
import Spinner from '../components/Spinner'
import OrderThread from '../components/OrderThread'
import StylePicker from '../components/StylePicker'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CATEGORIES, normalizeCategory } from '../data/products'
import { fetchAllProducts, addProduct, updateProduct, deleteProduct, uploadProductImage, uploadProductAudio, uploadRelease, listReleases, loadDraft, saveDraft, clearDraft, slugify, formatItemNumber } from '../data/storage'
import CropModal   from '../components/CropModal'
import ReviewDeck  from '../components/ReviewDeck'
import AvailabilityManager from '../components/AvailabilityManager'
import { collection, collectionGroup, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, where, increment, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, storage, functions } from '../lib/firebase'
import { runAiJob } from '../lib/aiJob'
import { fetchArchive, addArchiveItem, deleteArchiveItem } from '../data/archive'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { addTask, addBusinessDays, todayStr, TASK_TYPES } from '../data/tasks'
import { approveSubmission } from '../data/events'
import { applyWatermark } from '../lib/watermark'
import BarcodeScanner from '../components/BarcodeScanner'

// ─────────────────────────────────────────────────────────────────────

const MAX_PHOTOS = 10  // per listing / per bulk upload

// Compress an image client-side: cap the long edge and re-encode JPEG.
// Cuts upload size (saves data + faster) while keeping listing-quality detail.
// Never throws — falls back to the original file on any error.
async function compressImage(file, maxEdge = 1600, quality = 0.85) {
  try {
    if (!file || !file.type || !file.type.startsWith('image/')) return file
    const bitmap = await createImageBitmap(file)
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxEdge / longest)
    if (scale === 1 && file.size < 700 * 1024) return file  // already small enough
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file  // don't upsize
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

const MEDIUMS       = ['Pen', 'Crayon', 'Mixed', 'Ink', 'Paint', 'Digital', 'Photography']
const SERIES        = ['Ruins of Drumwind', 'Tree of Life']
const VINTAGE_TYPES = ['VHS Players', 'Vintage Cameras', 'Cassette Players', 'Record Players', 'DVD Players', 'Multi Media Players']
const MEDIA_TYPES   = ['Vinyl', 'CDs', 'Cassette Tapes', '8 Tracks', 'VHS Tapes']

const CONDITION_OPTIONS = [
  '',
  'New',
  'Like New',
  'Very Good',
  'Good',
  'Fair',
  'Poor',
]

const BLANK = {
  name: '',
  category: 'Art',
  medium: '',
  series: '',
  type: '',
  price: '',
  description: '',
  details: '',
  size: '',
  year: '',
  condition: '',
  genre: '',
  artist: '',
  albumTitle: '',
  styles: [],
  weightOz:      '',
  stock:         '',
  acceptsDeposit: false,
  depositAmount:  '',
  crossListings:  [],   // [{ id, name, type }] — same album, other formats
  digitalUrl:     '',   // link to stream/buy digital version (Bandcamp, Spotify, etc.)
  previewTracks:  [],   // [{ title, url }] — public preview clips, played on the product page
  downloadPath:   '',   // Storage path of the paid download (digital listings only)
  isPrint:    false,
  isOriginal: false,
  unique:      false,
  localPickup:  false,
  localDropoff: false,  // artist drops off at store → 5% commission, ships or pickup
  newArrival:   false,
  localLegend:  false,
  image:    null,
  imageURL: null,
  emoji: '🖼️',
}

function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const SLOT_LABELS = {
  'Vinyl':            ['Front Jacket', 'Back Jacket', 'Front Record', 'Back Record', 'Detail 1', 'Detail 2'],
  'CDs':              ['Front Case', 'Back Case', 'Disc', 'Insert', 'Detail 1', 'Detail 2'],
  'Cassette Tapes':   ['Front', 'Back', 'Tape', 'Insert', 'Detail 1', 'Detail 2'],
  '8 Tracks':         ['Front', 'Back', 'Detail 1', 'Detail 2', 'Detail 3', 'Detail 4'],
  'VHS Tapes':        ['Front', 'Back', 'Detail 1', 'Detail 2', 'Detail 3', 'Detail 4'],
  'Art':              ['Main Photo', 'Detail Shot', 'Alt. View', 'Back', 'Extra', 'Extra'],
  'Vintage Tech':     ['Front', 'Back', 'Detail', 'Side', 'Extra', 'Extra'],
  'Get On The Flora': ['Main Photo', 'Detail', 'Extra', 'Extra', 'Extra', 'Extra'],
  'Clothing':         ['Front', 'Back', 'Detail', 'Lifestyle', 'Extra', 'Extra'],
}

const VINYL_GENRES = [
  'Hip-Hop', 'Jazz', 'Soul', 'R&B', 'Funk', 'Blues', 'Gospel',
  'Rock', 'Classic Rock', 'Punk', 'Metal', 'Alternative', 'Indie',
  'Pop', 'Electronic', 'Dance', 'Reggae', 'Latin', 'World',
  'Classical', 'Spoken Word', 'Soundtrack', 'Compilation', 'Other',
]

// ── SEO Article Generator (AI) ────────────────────────────────────────────────
function AiUsagePanel() {
  const [usage,  setUsage]  = useState(null)
  const [budget, setBudget] = useState('')
  const [saving, setSaving] = useState(false)
  const month = new Date().toISOString().slice(0, 7)

  const LABELS = {
    quickfill: 'Quick Fill (listing assist)',
    seo:       'SEO articles',
    spotlight: 'Artist spotlights',
    interview: 'Interview drafts',
    ideas:     'Daily content ideas',
    qa:        'Site QA scans',
  }

  async function load() {
    try {
      const snap = await getDoc(doc(db, 'settings', 'aiUsage'))
      const u = snap.exists() ? snap.data() : {}
      setUsage(u)
      setBudget(u.monthlyBudgetUsd != null ? String(u.monthlyBudgetUsd) : '')
    } catch { setUsage({}) }
  }
  useEffect(() => { load() }, [])

  if (!usage) return <p className="font-mono text-[13px] text-warm-gray py-8">Loading…</p>

  const fresh      = usage.month === month
  const counts     = fresh ? (usage.counts || {}) : {}
  const spent      = fresh ? Number(usage.estCostUsd) || 0 : 0
  const budgetNum  = Number(usage.monthlyBudgetUsd) || 0
  const totalCalls = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
  const pct        = budgetNum > 0 ? Math.min(100, (spent / budgetNum) * 100) : 0
  const paused     = usage.paused === true
  const overBudget = budgetNum > 0 && spent >= budgetNum

  async function saveBudget() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'aiUsage'), { monthlyBudgetUsd: Number(budget) || 0 }, { merge: true })
      setUsage(u => ({ ...u, monthlyBudgetUsd: Number(budget) || 0 }))
    } finally { setSaving(false) }
  }
  async function togglePause() {
    const next = !paused
    await setDoc(doc(db, 'settings', 'aiUsage'), { paused: next }, { merge: true })
    setUsage(u => ({ ...u, paused: next }))
  }

  return (
    <div style={{ maxWidth: '640px' }}>
      <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5030', margin: '0 0 6px' }}>
        AI Usage & Budget
      </p>
      <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5a4f44', margin: '0 0 20px', lineHeight: 1.6 }}>
        Estimated AI spend this month against your Google Cloud credits. All AI runs on Vertex/Gemini in your project — set a ceiling so credits get used, not wasted, and never run away.
      </p>

      {/* Spend meter */}
      <div style={{ border: '1px solid #e8e0d4', background: '#faf8f4', padding: '16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1208' }}>
            ~${spent.toFixed(2)} {budgetNum > 0 && <span style={{ color: '#8a7560' }}>/ ${budgetNum.toFixed(2)}</span>}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7560' }}>{totalCalls} calls · {month}</span>
        </div>
        {budgetNum > 0 && (
          <div style={{ height: '8px', background: '#e8e0d4', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: overBudget ? '#b94040' : pct > 80 ? '#b97a30' : '#3a7a40', transition: 'width 0.3s' }} />
          </div>
        )}
        {overBudget && (
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: '8px 0 0' }}>
            Budget reached — new AI jobs are paused until next month or you raise the cap.
          </p>
        )}
      </div>

      {/* Breakdown */}
      <div style={{ marginBottom: '20px' }}>
        {Object.keys(LABELS).map(k => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0ece4' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5a4f44' }}>{LABELS[k]}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208' }}>{Number(counts[k]) || 0}</span>
          </div>
        ))}
      </div>

      {/* Budget control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <label style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5a4f44' }}>Monthly budget ($, 0 = no cap):</label>
        <input
          type="number" min="0" step="1" value={budget}
          onChange={e => setBudget(e.target.value)}
          style={{ width: '90px', fontFamily: 'monospace', fontSize: '13px', padding: '7px 10px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none' }}
        />
        <button onClick={saveBudget} disabled={saving}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '7px 16px', background: '#1a1208', color: '#f5f2ec', border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Pause toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '14px 16px', border: '1px solid #e8e0d4', background: paused ? 'rgba(185,64,64,0.05)' : 'transparent' }}>
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1208', margin: '0 0 2px' }}>{paused ? 'AI paused' : 'AI active'}</p>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7560', margin: 0 }}>Master switch for all AI generation.</p>
        </div>
        <button onClick={togglePause}
          style={{ width: '44px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', background: paused ? '#b94040' : '#3a7a40', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}
          aria-label="Toggle AI">
          <span style={{ position: 'absolute', top: '4px', left: paused ? '4px' : '22px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
      </div>
    </div>
  )
}

function SeoArticleGenerator({ onGenerated }) {
  const [cfg,      setCfg]      = useState(null)
  const [topic,    setTopic]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [msg,      setMsg]      = useState(null)
  const [newTopic, setNewTopic] = useState('')
  const [savingQuota, setSavingQuota] = useState(false)

  const month = new Date().toISOString().slice(0, 7)

  async function loadCfg() {
    try {
      const snap = await getDoc(doc(db, 'settings', 'seoConfig'))
      setCfg(snap.exists() ? snap.data() : { monthlyQuota: 8, topics: [], usage: { month, count: 0 } })
    } catch { setCfg({ monthlyQuota: 8, topics: [], usage: { month, count: 0 } }) }
  }
  useEffect(() => { loadCfg() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return null

  const quota = Number(cfg.monthlyQuota) || 8
  const used  = (cfg.usage && cfg.usage.month === month) ? Number(cfg.usage.count) || 0 : 0
  const remaining = Math.max(0, quota - used)

  async function generate() {
    if (!topic.trim()) return
    setBusy(true); setMsg(null)
    try {
      const res = await runAiJob('seo', { topic: topic.trim() })
      setMsg({ ok: true, text: `Draft created: "${res.title}" — now in Pending Review below.` })
      setTopic('')
      await loadCfg()
      onGenerated?.()
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Generation failed.' })
    } finally { setBusy(false) }
  }

  async function saveQuota(n) {
    setSavingQuota(true)
    try {
      await setDoc(doc(db, 'settings', 'seoConfig'), { monthlyQuota: n }, { merge: true })
      setCfg(c => ({ ...c, monthlyQuota: n }))
    } finally { setSavingQuota(false) }
  }

  async function addTopic() {
    if (!newTopic.trim()) return
    const next = [...(cfg.topics || []), newTopic.trim()]
    await setDoc(doc(db, 'settings', 'seoConfig'), { topics: next }, { merge: true })
    setCfg(c => ({ ...c, topics: next })); setNewTopic('')
  }
  async function removeTopic(i) {
    const next = (cfg.topics || []).filter((_, idx) => idx !== i)
    await setDoc(doc(db, 'settings', 'seoConfig'), { topics: next }, { merge: true })
    setCfg(c => ({ ...c, topics: next }))
  }

  return (
    <div style={{ border: '1px solid #a08060', background: 'rgba(160,128,96,0.06)', padding: '16px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5030', margin: 0 }}>
          ✦ AI Article Generator
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: remaining === 0 ? '#b94040' : '#3a7a40', margin: 0 }}>
          {used} / {quota} used this month · {remaining} left
        </p>
      </div>

      {/* On-demand */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <input
          type="text" value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="Topic, e.g. 'How to start collecting local art in Fort Wayne'"
          onKeyDown={e => { if (e.key === 'Enter') generate() }}
          style={{ flex: 1, minWidth: '220px', fontFamily: 'monospace', fontSize: '12px', padding: '9px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none' }}
        />
        <button onClick={generate} disabled={busy || remaining === 0 || !topic.trim()}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '9px 18px', background: '#1a1208', color: '#f5f2ec', border: 'none', cursor: busy || remaining === 0 ? 'default' : 'pointer', opacity: busy || remaining === 0 || !topic.trim() ? 0.5 : 1 }}>
          {busy ? 'Writing…' : 'Generate Draft'}
        </button>
      </div>

      {msg && (
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: msg.ok ? '#3a7a40' : '#b94040', margin: '0 0 12px' }}>
          {msg.text}
        </p>
      )}

      {/* Quota + scheduled topic list */}
      <details style={{ marginTop: '6px' }}>
        <summary style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5c3a', cursor: 'pointer' }}>
          Settings · monthly cap & weekly topic queue
        </summary>
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Quota */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontFamily: 'monospace', fontSize: '11px', color: '#5a4f44' }}>Articles per month:</label>
            <input
              type="number" min="0" max="100" defaultValue={quota}
              onBlur={e => saveQuota(Number(e.target.value) || 0)}
              style={{ width: '64px', fontFamily: 'monospace', fontSize: '12px', padding: '5px 8px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none' }}
            />
            {savingQuota && <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a08060' }}>saving…</span>}
          </div>

          {/* Topic queue */}
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '6px' }}>
              Weekly queue — one article auto-drafted every Monday
            </p>
            {(cfg.topics || []).length === 0 && (
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a08060', marginBottom: '8px' }}>No topics queued. Add some below.</p>
            )}
            {(cfg.topics || []).map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3d2810', flex: 1 }}>{i + 1}. {t}</span>
                <button onClick={() => removeTopic(i)} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b94040', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <input
                type="text" value={newTopic} onChange={e => setNewTopic(e.target.value)}
                placeholder="Add a topic to the weekly queue…"
                onKeyDown={e => { if (e.key === 'Enter') addTopic() }}
                style={{ flex: 1, fontFamily: 'monospace', fontSize: '11px', padding: '7px 10px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none' }}
              />
              <button onClick={addTopic} disabled={!newTopic.trim()}
                style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '7px 14px', background: 'transparent', color: '#1a1208', border: '1px solid #a08060', cursor: newTopic.trim() ? 'pointer' : 'default', opacity: newTopic.trim() ? 1 : 0.5 }}>
                Add
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}

// ── Artist Spotlight Generator (AI) ───────────────────────────────────────────
function SpotlightGenerator({ onGenerated }) {
  const [artists, setArtists] = useState([])
  const [picked,  setPicked]  = useState('')
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('artistPublic', '==', true)))
      .then(snap => setArtists(snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))))
      .catch(() => {})
  }, [])

  async function generate() {
    if (!picked) return
    setBusy(true); setMsg(null)
    try {
      const res = await runAiJob('spotlight', { uid: picked })
      setMsg({ ok: true, text: `Spotlight drafted: "${res.title}" — now in Pending Review below.` })
      setPicked('')
      onGenerated?.()
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Generation failed.' })
    } finally { setBusy(false) }
  }

  return (
    <div style={{ border: '1px solid #a08060', background: 'rgba(122,80,48,0.05)', padding: '16px', marginBottom: '24px' }}>
      <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5030', margin: '0 0 12px' }}>
        ✦ Artist Spotlight Generator
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <select
          value={picked} onChange={e => setPicked(e.target.value)}
          style={{ flex: 1, minWidth: '220px', fontFamily: 'monospace', fontSize: '12px', padding: '9px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none' }}
        >
          <option value="">Choose a public artist…</option>
          {artists.map(a => <option key={a.uid} value={a.uid}>{a.name || a.uid}</option>)}
        </select>
        <button onClick={generate} disabled={busy || !picked}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '9px 18px', background: '#7a5030', color: '#f5f2ec', border: 'none', cursor: busy || !picked ? 'default' : 'pointer', opacity: busy || !picked ? 0.5 : 1 }}>
          {busy ? 'Writing…' : 'Draft Spotlight'}
        </button>
      </div>
      {artists.length === 0 && (
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a08060', margin: '10px 0 0' }}>
          No public artists yet — artists opt in via Account → Artist Profile → "Show in Discover Artists."
        </p>
      )}
      {msg && (
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: msg.ok ? '#3a7a40' : '#b94040', margin: '10px 0 0' }}>
          {msg.text}
        </p>
      )}
    </div>
  )
}

// ── Orders Panel ─────────────────────────────────────────────────────────────
function OrdersPanel() {
  const { user, profile } = useAuth()
  const [orders,      setOrders]      = useState([])
  const [commissions, setCommissions] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [subTab,      setSubTab]      = useState('orders')
  const [catFilter,   setCatFilter]   = useState('all')
  const [deadlines,   setDeadlines]   = useState({})
  const [bulkBusy,    setBulkBusy]    = useState(false)
  const [labelState,  setLabelState]  = useState({})   // { [orderId]: { phase, rates, selectedRate, error } }

  // Shippo callable functions
  const fnGetRates     = httpsCallable(functions, 'getShippingRates')
  const fnBuyLabel     = httpsCallable(functions, 'purchaseShippingLabel')

  function setLS(orderId, patch) {
    setLabelState(prev => ({ ...prev, [orderId]: { ...prev[orderId], ...patch } }))
  }

  async function fetchRates(orderId) {
    setLS(orderId, { phase: 'fetching', rates: null, selectedRate: null, error: null })
    try {
      const { data } = await fnGetRates({ orderId })
      setLS(orderId, { phase: 'picking', rates: data })
    } catch (err) {
      setLS(orderId, { phase: 'error', error: err.message || 'Failed to fetch rates.' })
    }
  }

  async function buyLabel(orderId) {
    const ls = labelState[orderId]
    if (!ls?.selectedRate) return
    setLS(orderId, { phase: 'buying' })
    try {
      const { data } = await fnBuyLabel({ orderId, rateObjectId: ls.selectedRate })
      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, status: 'shipped', trackingNumber: data.trackingNumber, labelUrl: data.labelUrl }
        : o
      ))
      setLS(orderId, { phase: 'idle', rates: null, selectedRate: null })
    } catch (err) {
      setLS(orderId, { phase: 'error', error: err.message || 'Failed to purchase label.' })
    }
  }

  useEffect(() => {
    async function load() {
      const [oSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'commissions'), orderBy('submittedAt', 'desc'))),
      ])
      setOrders(oSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setCommissions(cSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }
    load()
  }, [])

  async function cancelOrder(order) {
    if (!window.confirm('Cancel this order? Stock will be restored if the order was paid.')) return
    const batch = writeBatch(db)
    batch.update(doc(db, 'orders', order.id), { status: 'cancelled' })
    if (order.paymentStatus === 'paid' && order.items?.length) {
      for (const item of order.items) {
        if (item.id) batch.update(doc(db, 'products', item.id), { sold: false, ...(item.qty ? { stock: increment(item.qty) } : {}) })
      }
    }
    await batch.commit()
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'cancelled' } : o))
  }

  async function archiveOrder(order) {
    await updateDoc(doc(db, 'orders', order.id), { archived: true })
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, archived: true } : o))
  }

  async function unarchiveOrder(order) {
    await updateDoc(doc(db, 'orders', order.id), { archived: false })
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, archived: false } : o))
  }

  async function deleteOrder(order) {
    if (!window.confirm(`Permanently delete order #${order.id.slice(-6).toUpperCase()}? This cannot be undone.`)) return
    await deleteDoc(doc(db, 'orders', order.id))
    setOrders(prev => prev.filter(o => o.id !== order.id))
  }

  async function archiveBulk(filterFn, label) {
    const targets = orders.filter(o => !o.archived && filterFn(o))
    if (!targets.length) return
    if (!window.confirm(`Archive ${targets.length} ${label} order${targets.length !== 1 ? 's' : ''}? They'll move to the Archived tab.`)) return
    setBulkBusy(true)
    try {
      const batch = writeBatch(db)
      targets.forEach(o => batch.update(doc(db, 'orders', o.id), { archived: true }))
      await batch.commit()
      const ids = new Set(targets.map(t => t.id))
      setOrders(prev => prev.map(o => ids.has(o.id) ? { ...o, archived: true } : o))
    } finally { setBulkBusy(false) }
  }

  async function deleteAllArchived() {
    const archived = orders.filter(o => o.archived)
    if (!archived.length) return
    if (!window.confirm(`Permanently delete all ${archived.length} archived orders? This cannot be undone.`)) return
    if (!window.confirm('Final confirmation — this will erase all archived records forever.')) return
    setBulkBusy(true)
    try {
      const batch = writeBatch(db)
      archived.forEach(o => batch.delete(doc(db, 'orders', o.id)))
      await batch.commit()
      setOrders(prev => prev.filter(o => !o.archived))
      setCatFilter('all')
    } finally { setBulkBusy(false) }
  }

  async function setShipDeadline(order, days) {
    const deadline = addBusinessDays(todayStr(), days)
    const label    = order.items?.map(i => i.name).join(', ') || 'Order'
    await addTask({ date: deadline, title: `Ship — ${label}`, type: 'shipping', notes: `${days} business days · Order #${order.id.slice(-6)} · $${order.total?.toFixed(2) || '?'}`, orderId: order.id })
    setDeadlines(p => ({ ...p, [order.id]: { days, done: true } }))
  }

  const formatDate = ts => {
    if (!ts?.seconds) return '—'
    return new Date(ts.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const statusColor = { pending: '#b97a30', ready: '#3a7a40', completed: '#8a5c3a', cancelled: '#b94040', shipped: '#3a5a7a' }

  // Derived
  const activeOrders   = orders.filter(o => !o.archived)
  const archivedOrders = orders.filter(o => o.archived)
  const activeCats     = [...new Set(activeOrders.flatMap(o => (o.items || []).map(i => i.category).filter(Boolean)))]
  const cancelledCount = activeOrders.filter(o => o.status === 'cancelled').length
  const completedCount = activeOrders.filter(o => o.status === 'completed').length

  // An order doc is written before the Stripe redirect, so "unpaid" == abandoned
  // checkout, not a sale awaiting fulfilment. Keep the two separable.
  const isPaid       = o => o.paymentStatus === 'paid' || o.paymentStatus === 'deposit_paid'
  const paidCount    = activeOrders.filter(isPaid).length
  const unpaidCount  = activeOrders.filter(o => !isPaid(o) && o.status !== 'cancelled').length

  const visibleOrders = catFilter === 'archived'
    ? archivedOrders
    : catFilter === 'all'
      ? activeOrders
      : catFilter === 'paid'
        ? activeOrders.filter(isPaid)
        : catFilter === 'unpaid'
          ? activeOrders.filter(o => !isPaid(o) && o.status !== 'cancelled')
          : activeOrders.filter(o => (o.items || []).some(i => i.category === catFilter))

  const pill = (active, danger = false) =>
    `font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 border transition-colors cursor-pointer whitespace-nowrap ${
      active
        ? 'bg-ink text-cream border-ink'
        : danger
          ? 'border-red-200 text-red-400 hover:border-red-400'
          : 'border-warm-gray-light text-warm-gray hover:border-ink hover:text-ink'
    }`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => setSubTab('orders')}      className={pill(subTab === 'orders')}>Orders ({activeOrders.length})</button>
        <button onClick={() => setSubTab('commissions')} className={pill(subTab === 'commissions')}>Commissions ({commissions.length})</button>
      </div>

      {loading && <p className="font-mono text-[12px] text-warm-gray">Loading…</p>}

      {/* ── Product Orders ── */}
      {!loading && subTab === 'orders' && (
        <>
          {/* Category filter bar — scrollable on mobile */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
            <button onClick={() => setCatFilter('all')}      className={pill(catFilter === 'all')}>All ({activeOrders.length})</button>
            <button onClick={() => setCatFilter('paid')}     className={pill(catFilter === 'paid')}>Paid ({paidCount})</button>
            <button onClick={() => setCatFilter('unpaid')}   className={pill(catFilter === 'unpaid')}>Unpaid ({unpaidCount})</button>
            {activeCats.map(cat => (
              <button key={cat} onClick={() => setCatFilter(cat)} className={pill(catFilter === cat)}>
                {cat} ({activeOrders.filter(o => (o.items || []).some(i => i.category === cat)).length})
              </button>
            ))}
            <button onClick={() => setCatFilter('archived')} className={pill(catFilter === 'archived', true)}>
              Archived ({archivedOrders.length})
            </button>
          </div>

          {/* Bulk actions bar */}
          {catFilter !== 'archived' ? (
            (cancelledCount > 0 || completedCount > 0 || activeOrders.length > 0) && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: '#f5f0e8', border: '1px solid #e8e0d4' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#9a7050', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Archive:</span>
                {cancelledCount > 0 && (
                  <button onClick={() => archiveBulk(o => o.status === 'cancelled', 'cancelled')} disabled={bulkBusy}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Cancelled ({cancelledCount})
                  </button>
                )}
                {unpaidCount > 0 && (
                  <button onClick={() => archiveBulk(o => !isPaid(o) && o.status !== 'cancelled', 'unpaid / abandoned')} disabled={bulkBusy}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Unpaid ({unpaidCount})
                  </button>
                )}
                {completedCount > 0 && (
                  <button onClick={() => archiveBulk(o => o.status === 'completed', 'completed')} disabled={bulkBusy}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Completed ({completedCount})
                  </button>
                )}
                {activeOrders.length > 0 && (
                  <button onClick={() => archiveBulk(() => true, 'all')} disabled={bulkBusy}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Archive All
                  </button>
                )}
              </div>
            )
          ) : (
            archivedOrders.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', background: '#fff8f8', border: '1px solid #f0d8d8' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#9a6060' }}>
                  {archivedOrders.length} archived — safe to permanently delete when ready
                </span>
                <button onClick={deleteAllArchived} disabled={bulkBusy}
                  style={{ fontFamily: 'monospace', fontSize: '10px', padding: '5px 12px', border: '1px solid #e09090', background: 'transparent', cursor: 'pointer', color: '#b94040', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                  Delete All ({archivedOrders.length})
                </button>
              </div>
            )
          )}

          {/* Order list */}
          {visibleOrders.length === 0 ? (
            <p className="font-mono text-[12px] text-warm-gray py-4">
              {catFilter === 'archived' ? 'No archived orders.' : 'No orders here.'}
            </p>
          ) : visibleOrders.map(order => (
            <div key={order.id} style={{ border: `1px solid ${order.archived ? '#f0d8d8' : order.status === 'cancelled' ? '#e8d4d4' : '#e8e0d4'}`, padding: '14px 16px', background: order.archived ? '#fdf5f5' : order.status === 'cancelled' ? '#fdf8f8' : '#faf8f4', display: 'flex', flexDirection: 'column', gap: '8px', opacity: order.archived ? 0.75 : order.status === 'cancelled' ? 0.8 : 1 }}>

              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '4px' }}>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', margin: 0, fontWeight: 'bold' }}>
                    #{order.id.slice(-6).toUpperCase()} · {order.email}
                  </p>
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: '2px 0 0' }}>
                    {formatDate(order.createdAt)} · ${order.total?.toFixed(2) || '?'}
                    {order.shippingMethod === 'pickup' && <span style={{ marginLeft: '6px', color: '#b97a30' }}>· Pickup</span>}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  {[...new Set((order.items || []).map(i => i.category).filter(Boolean))].map(cat => (
                    <span key={cat} style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a7060', padding: '1px 6px', border: '1px solid #d4c9bb', background: '#f5f0e8' }}>{cat}</span>
                  ))}
                  {order.archived && (
                    <span style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#b07070', padding: '1px 6px', border: '1px solid #e0b0b0', background: '#fff0f0' }}>Archived</span>
                  )}
                  {/* Payment state is the only way to tell a real sale from an abandoned cart —
                      the order doc is written before the Stripe redirect. */}
                  {(() => {
                    const ps = order.paymentStatus
                    const paid = ps === 'paid' || ps === 'deposit_paid'
                    return (
                      <span style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 'bold', padding: '1px 6px', border: `1px solid ${paid ? '#8fbf8f' : '#e0b0b0'}`, background: paid ? '#f0f8f0' : '#fff0f0', color: paid ? '#3a7a40' : '#b05050' }}>
                        {ps === 'deposit_paid' ? 'Deposit paid' : paid ? 'Paid' : 'Unpaid'}
                      </span>
                    )
                  })()}
                  <span style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: statusColor[order.status] || '#8a5c3a', padding: '2px 8px', border: `1px solid ${statusColor[order.status] || '#d4c9bb'}` }}>
                    {order.status || 'pending'}
                  </span>
                </div>
              </div>

              {/* Items */}
              {order.items?.map((item, i) => (
                <div key={i}>
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>
                    — {item.name}{item.qty > 1 ? ` ×${item.qty}` : ''} · ${item.price}
                    {item.category && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#a09080' }}>({item.category})</span>}
                  </p>
                  {item.notes && (
                    <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b97a30', margin: '2px 0 0 10px', fontStyle: 'italic' }}>
                      ↳ {item.notes}
                    </p>
                  )}
                </div>
              ))}

              {/* Buyer conversation about this order */}
              <OrderThread order={order} user={user} profile={profile} />

              {/* Ship deadline (active non-terminal only) */}
              {!order.archived && !['cancelled', 'completed', 'shipped'].includes(order.status) && (
                deadlines[order.id]?.done
                  ? <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3a7a40', marginTop: '2px' }}>✓ Ship deadline added ({deadlines[order.id].days}d)</p>
                  : (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '2px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ship by:</span>
                      {[3, 5, 7, 10].map(d => (
                        <button key={d} onClick={() => setShipDeadline(order, d)} style={{ fontFamily: 'monospace', fontSize: '10px', padding: '3px 8px', border: '1px solid #d4722a', color: '#b95a20', background: 'transparent', cursor: 'pointer' }}>{d}d</button>
                      ))}
                    </div>
                  )
              )}

              {/* ── Shipping label section ── */}
              {!order.archived && order.shippingMethod === 'ship' && !['cancelled', 'completed'].includes(order.status) && (() => {
                const ls = labelState[order.id] || {}
                return (
                  <div style={{ borderTop: '1px solid #ece5db', paddingTop: '8px' }}>
                    {/* Ship-to address */}
                    {order.shippingAddress ? (
                      <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#7a5030', margin: '0 0 6px' }}>
                        📦 {order.shippingAddress.name} — {order.shippingAddress.street1}{order.shippingAddress.street2 ? ` ${order.shippingAddress.street2}` : ''}, {order.shippingAddress.city} {order.shippingAddress.state} {order.shippingAddress.zip}
                      </p>
                    ) : (
                      <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b97a30', margin: '0 0 6px' }}>
                        ⚠ No address on file — order placed before address collection
                      </p>
                    )}

                    {/* Already has a Shippo label */}
                    {order.labelUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <a href={order.labelUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #3a7a40', color: '#3a7a40', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          🖨 Print Label
                        </a>
                        {order.trackingNumber && (
                          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#3a5a7a' }}>
                            Tracking: {order.trackingNumber}
                          </span>
                        )}
                      </div>
                    ) : order.status === 'shipped' ? (
                      <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#3a5a7a' }}>
                        ✓ Shipped{order.trackingNumber ? ` · ${order.trackingNumber}` : ''}
                      </p>
                    ) : order.shippingAddress && (
                      /* Rate fetch → pick → buy flow */
                      <>
                        {(!ls.phase || ls.phase === 'idle') && (
                          <button onClick={() => fetchRates(order.id)}
                            style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #3a5a7a', color: '#3a5a7a', background: 'transparent', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Get Rates
                          </button>
                        )}
                        {ls.phase === 'fetching' && (
                          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#7a5030' }}>Fetching rates…</p>
                        )}
                        {ls.phase === 'picking' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#7a5030', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Select a rate:</p>
                            {(ls.rates || []).map(rate => (
                              <label key={rate.objectId} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input type="radio" name={`rate-${order.id}`}
                                  checked={ls.selectedRate === rate.objectId}
                                  onChange={() => setLS(order.id, { selectedRate: rate.objectId })} />
                                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#1a1208' }}>
                                  {rate.carrier} {rate.service} — <strong>${rate.amount}</strong>
                                  {rate.days ? ` · ${rate.days}d` : ''}
                                </span>
                              </label>
                            ))}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                              <button onClick={() => buyLabel(order.id)} disabled={!ls.selectedRate}
                                style={{ fontFamily: 'monospace', fontSize: '10px', padding: '5px 14px', background: ls.selectedRate ? '#1a1208' : '#c4b4a0', color: '#f2ebe0', border: 'none', cursor: ls.selectedRate ? 'pointer' : 'not-allowed', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Buy Label
                              </button>
                              <button onClick={() => setLS(order.id, { phase: 'idle', rates: null, selectedRate: null })}
                                style={{ fontFamily: 'monospace', fontSize: '10px', padding: '5px 10px', border: '1px solid #d4c9bb', color: '#8a5c3a', background: 'transparent', cursor: 'pointer' }}>
                                ✕
                              </button>
                            </div>
                          </div>
                        )}
                        {ls.phase === 'buying' && (
                          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#7a5030' }}>Purchasing label…</p>
                        )}
                        {ls.phase === 'error' && (
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b94040', margin: 0 }}>{ls.error}</p>
                            <button onClick={() => setLS(order.id, { phase: 'idle' })}
                              style={{ fontFamily: 'monospace', fontSize: '10px', padding: '3px 8px', border: '1px solid #e0b0b0', color: '#b94040', background: 'transparent', cursor: 'pointer' }}>
                              Retry
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })()}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px', borderTop: '1px solid #ece5db', paddingTop: '8px' }}>
                {!order.archived ? (
                  <>
                    {!['cancelled', 'completed', 'shipped'].includes(order.status) && (
                      <button onClick={() => cancelOrder(order)}
                        style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #e0b0b0', color: '#b94040', background: 'transparent', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Cancel
                      </button>
                    )}
                    <button onClick={() => archiveOrder(order)}
                      style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #d4c9bb', color: '#8a5c3a', background: 'transparent', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Archive
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => unarchiveOrder(order)}
                      style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #d4c9bb', color: '#8a5c3a', background: 'transparent', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Restore
                    </button>
                    <button onClick={() => deleteOrder(order)}
                      style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', border: '1px solid #e09090', color: '#b94040', background: 'transparent', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Delete
                    </button>
                  </>
                )}
              </div>

            </div>
          ))}
        </>
      )}

      {/* ── Commission Requests ── */}
      {!loading && subTab === 'commissions' && (
        commissions.length === 0
          ? <p className="font-mono text-[12px] text-warm-gray">No commission requests yet.</p>
          : commissions.map(comm => (
            <div key={comm.id} style={{ border: '1px solid #e8e0d4', padding: '14px 16px', background: '#faf8f4', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', margin: 0, fontWeight: 'bold' }}>{comm.contactName} · {comm.contactEmail}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: '2px 0 0' }}>
                    {comm.medium} · {comm.size} · ${comm.totalCostMin}–${comm.totalCostMax}{comm.framed ? ' · Framed' : ''}
                  </p>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: statusColor[comm.status] || '#b97a30', padding: '2px 8px', border: `1px solid ${statusColor[comm.status] || '#e8c87a'}` }}>
                  {comm.status || 'pending'}
                </span>
              </div>
              {comm.notes && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', fontStyle: 'italic' }}>"{comm.notes}"</p>}
              <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b0a898', margin: 0 }}>
                Est. {comm.estimatedHrsMin}–{comm.estimatedHrsMax} hrs · Deadline auto-added to calendar on submit
              </p>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                {comm.status === 'pending' && (
                  <>
                    <button onClick={() => updateDoc(doc(db, 'commissions', comm.id), { status: 'in_progress' }).then(() => setCommissions(p => p.map(c => c.id === comm.id ? { ...c, status: 'in_progress' } : c)))}
                      style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', background: '#3a7a40', color: '#fff', border: 'none', cursor: 'pointer' }}>Accept</button>
                    <button onClick={() => updateDoc(doc(db, 'commissions', comm.id), { status: 'declined' }).then(() => setCommissions(p => p.map(c => c.id === comm.id ? { ...c, status: 'declined' } : c)))}
                      style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', background: '#b94040', color: '#fff', border: 'none', cursor: 'pointer' }}>Decline</button>
                  </>
                )}
                {comm.status === 'in_progress' && (
                  <button onClick={() => updateDoc(doc(db, 'commissions', comm.id), { status: 'completed' }).then(() => setCommissions(p => p.map(c => c.id === comm.id ? { ...c, status: 'completed' } : c)))}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', background: '#1a1208', color: '#fff', border: 'none', cursor: 'pointer' }}>Mark Complete</button>
                )}
              </div>
            </div>
          ))
      )}
    </div>
  )
}

// ── Submissions Panel ─────────────────────────────────────────────────────────
function SubmissionsPanel() {
  const [submissions,    setSubmissions]    = useState([])
  const [loading,        setLoading]        = useState(true)
  const [filter,         setFilter]         = useState('pending_review')
  const [search,         setSearch]         = useState('')
  const [rejectingId,    setRejectingId]    = useState(null)
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [feedbackId,     setFeedbackId]     = useState(null)   // which sub is open for admin feedback
  const [feedbackText,   setFeedbackText]   = useState('')
  const [busy,           setBusy]           = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const q    = query(collection(db, 'submissions'), orderBy('submittedAt', 'desc'))
        const snap = await getDocs(q)
        setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error('SubmissionsPanel load:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function approveSubmission(id) {
    setBusy(true)
    try {
      const sub = submissions.find(s => s.id === id)
      if (!sub) throw new Error('Submission not found')

      // Create a product in the shop from the submission data.
      // Clothing submissions keep their garment type; everything else defaults
      // to Art. normalizeCategory covers submissions written before the
      // 'Room 40 Threads' → 'Clothing' rename.
      const shopCategory  = normalizeCategory(sub.shopCategory || 'Art')
      const isClothingSub = shopCategory === 'Clothing'
      const productRef = await addProduct({
        name:        sub.title        || '',
        category:    shopCategory,
        garmentType: sub.garmentType  || '',                 // Tops / Bottoms / Accessories / Custom (clothing)
        medium:      isClothingSub ? (sub.medium || '') : (sub.category || sub.medium || ''),
        description: sub.description  || '',
        price:       sub.price        || 0,
        image:       sub.imageURL     || '',
        imageURL:    sub.imageURL     || '',
        slug:        slugify(sub.title || id),
        sellerId:    sub.uid          || '',
        artistUid:   sub.uid          || '',
        artistName:  sub.artistName   || '',
        artistPayout: sub.artistPayout || 0,
        weightOz:    sub.weightOz     || 0,
        dimensions:  sub.dimensions   || '',
        year:        sub.year         || null,
        styles:      sub.styles       || [],
        unique:      true,
        source:      'submission',
        submissionId: id,
        active:      true,
      })

      // Mark submission approved and link to the created product
      await updateDoc(doc(db, 'submissions', id), {
        status:    'approved',
        productId: productRef.id,
      })
      setSubmissions(prev => prev.map(s => s.id === id
        ? { ...s, status: 'approved', productId: productRef.id }
        : s
      ))
    } catch (err) {
      console.error('approveSubmission failed:', err)
      alert('Approval failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  async function syncToShop(id) {
    setBusy(true)
    try {
      const sub = submissions.find(s => s.id === id)
      if (!sub) throw new Error('Submission not found')

      const productRef = await addProduct({
        name:         sub.title        || '',
        category:     'Art',
        medium:       sub.category     || sub.medium || '',
        description:  sub.description  || '',
        price:        sub.price        || 0,
        image:        sub.imageURL     || '',
        imageURL:     sub.imageURL     || '',
        slug:         slugify(sub.title || id),
        sellerId:     sub.uid          || '',
        artistUid:    sub.uid          || '',
        artistName:   sub.artistName   || '',
        artistPayout: sub.artistPayout || 0,
        weightOz:     sub.weightOz     || 0,
        dimensions:   sub.dimensions   || '',
        year:         sub.year         || null,
        styles:       sub.styles       || [],
        unique:       true,
        source:       'submission',
        submissionId: id,
        active:       true,
      })

      await updateDoc(doc(db, 'submissions', id), { productId: productRef.id })
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, productId: productRef.id } : s))
      alert('Synced to shop!')
    } catch (err) {
      console.error('syncToShop failed:', err)
      alert('Sync failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmReject(id) {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'submissions', id), {
        status: 'rejected',
        ...(rejectFeedback.trim() ? { rejectionFeedback: rejectFeedback.trim() } : {}),
      })
      setSubmissions(prev => prev.map(s => s.id === id
        ? { ...s, status: 'rejected', rejectionFeedback: rejectFeedback.trim() || null }
        : s
      ))
      setRejectingId(null); setRejectFeedback('')
    } finally { setBusy(false) }
  }

  async function sendAdminFeedback(id) {
    if (!feedbackText.trim()) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'submissions', id), {
        adminFeedback:    feedbackText.trim(),
        feedbackAnswered: true,
        feedbackRequested: false,
      })
      setSubmissions(prev => prev.map(s => s.id === id
        ? { ...s, adminFeedback: feedbackText.trim(), feedbackAnswered: true, feedbackRequested: false }
        : s
      ))
      setFeedbackId(null); setFeedbackText('')
    } finally { setBusy(false) }
  }

  // pending_payment is a legacy state from the retired $1 listing fee. Nothing
  // creates it any more, but submissions stuck in it predate the change and were
  // unreachable here — no tab, no colour — so they are surfaced to be resolved.
  const statusColor = { pending_review: '#b97a30', approved: '#3a7a40', rejected: '#b94040', pending_payment: '#6a6aaf' }

  const searchLC = search.toLowerCase()
  const filtered = submissions
    .filter(s => s.status === filter)
    .filter(s => !searchLC || [
      s.title, s.artistName, s.artistEmail,
      s.submissionNumber ? `SB-${String(s.submissionNumber).padStart(4,'0')}` : '',
    ].some(v => (v || '').toLowerCase().includes(searchLC)))

  return (
    <div>
      {/* Search + Filter row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by title, artist, or SB-XXXX…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: '12px', padding: '7px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none', flex: '1', minWidth: '200px' }}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {['pending_review', 'approved', 'rejected', 'pending_payment'].map(s => {
          const count = submissions.filter(x => x.status === s).length
          // Legacy-only bucket — hide the tab entirely once it is empty.
          if (s === 'pending_payment' && count === 0) return null
          const feedbackCount = s === 'rejected' ? submissions.filter(x => x.status === 'rejected' && x.feedbackRequested && !x.feedbackAnswered).length : 0
          return (
            <button key={s} onClick={() => setFilter(s)}
              className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 border transition-colors ${filter === s ? 'bg-ink text-cream border-ink' : 'border-warm-gray-light text-warm-gray'}`}>
              {s.replace('_', ' ')} ({count}){feedbackCount > 0 ? ` · ${feedbackCount} feedback req` : ''}
            </button>
          )
        })}
      </div>

      {loading && <p className="font-mono text-[12px] text-warm-gray">Loading...</p>}
      {!loading && filtered.length === 0 && (
        <p className="font-mono text-[12px] text-warm-gray">
          {search ? `No results for "${search}".` : `No ${filter.replace('_', ' ')} submissions.`}
        </p>
      )}

      {filtered.map(sub => {
        const sbNum = sub.submissionNumber ? `SB-${String(sub.submissionNumber).padStart(4,'0')}` : null
        const isRejecting = rejectingId === sub.id
        const isFeedback  = feedbackId  === sub.id
        return (
          <div key={sub.id} style={{ border: '1px solid #e8e0d4', marginBottom: '16px', background: '#faf8f4' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0' }}>
              {/* Image */}
              <div style={{ background: '#f2ebe0', aspectRatio: '1', overflow: 'hidden', position: 'relative' }}>
                {sub.imageURL
                  ? <img src={sub.imageURL} alt={sub.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>🖼️</div>
                }
                {sbNum && (
                  <span style={{ position: 'absolute', bottom: '4px', left: '4px', fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', background: 'rgba(26,24,20,0.7)', color: '#f5f2ec', padding: '2px 5px' }}>
                    {sbNum}
                  </span>
                )}
              </div>
              {/* Info */}
              <div style={{ padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '2px' }}>
                  <p style={{ fontFamily: 'serif', fontSize: '1rem', margin: 0, color: '#1a1208' }}>{sub.title}</p>
                  {sub.feedbackRequested && !sub.feedbackAnswered && (
                    <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#b97a30', border: '1px solid #b97a30', padding: '2px 6px', flexShrink: 0 }}>
                      Feedback Req.
                    </span>
                  )}
                </div>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: '0 0 4px' }}>
                  {sbNum && <span style={{ color: '#b97a30', marginRight: '6px' }}>{sbNum}</span>}
                  by {sub.artistName} · ${sub.price} · {sub.category}
                </p>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: statusColor[sub.status] || '#3d2810', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {sub.status.replace('_', ' ')}
                </p>
                {sub.description && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: '0 0 8px', lineHeight: '1.5' }}>{sub.description}</p>
                )}

                {/* Pending review actions */}
                {filter === 'pending_review' && !isRejecting && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => approveSubmission(sub.id)} disabled={busy}
                      style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '6px 12px', background: '#3a7a40', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                      Approve
                    </button>
                    <button onClick={() => { setRejectingId(sub.id); setRejectFeedback('') }}
                      style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '6px 12px', background: '#b94040', color: '#fff', border: 'none', cursor: 'pointer' }}>
                      Reject…
                    </button>
                  </div>
                )}

                {/* Backfill: approved submission with no product yet */}
                {sub.status === 'approved' && !sub.productId && (
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b94040' }}>
                      ⚠ Not in shop
                    </span>
                    <button onClick={() => syncToShop(sub.id)} disabled={busy}
                      style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 12px', background: '#b97a30', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                      Sync to Shop
                    </button>
                  </div>
                )}
                {sub.status === 'approved' && sub.productId && (
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#3a7a40', margin: '6px 0 0' }}>
                    ✓ Live in shop
                  </p>
                )}

                {/* Reject with feedback */}
                {isRejecting && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea
                      rows={3}
                      placeholder="Optional: add feedback for the artist (recommended)…"
                      value={rejectFeedback}
                      onChange={e => setRejectFeedback(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px', border: '1px solid #d4c9bb', background: '#fff', color: '#1a1208', outline: 'none', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => confirmReject(sub.id)} disabled={busy}
                        style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 14px', background: '#b94040', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                        Confirm Reject
                      </button>
                      <button onClick={() => setRejectingId(null)}
                        style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 12px', background: 'transparent', color: '#8a5c3a', border: '1px solid #d4c9bb', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Show existing rejection feedback */}
                {sub.status === 'rejected' && sub.rejectionFeedback && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: '6px 0 0', lineHeight: '1.5' }}>
                    <strong>Feedback sent:</strong> {sub.rejectionFeedback}
                  </p>
                )}

                {/* Admin respond to feedback request */}
                {sub.feedbackRequested && !sub.feedbackAnswered && filter === 'rejected' && !isFeedback && (
                  <button onClick={() => { setFeedbackId(sub.id); setFeedbackText('') }}
                    style={{ marginTop: '8px', fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 12px', background: '#b97a30', color: '#fff', border: 'none', cursor: 'pointer' }}>
                    Send Feedback
                  </button>
                )}
                {isFeedback && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea
                      rows={3}
                      placeholder="Write feedback for the artist…"
                      value={feedbackText}
                      onChange={e => setFeedbackText(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px', border: '1px solid #d4c9bb', background: '#fff', color: '#1a1208', outline: 'none', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => sendAdminFeedback(sub.id)} disabled={busy || !feedbackText.trim()}
                        style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 14px', background: '#b97a30', color: '#fff', border: 'none', cursor: 'pointer', opacity: (busy || !feedbackText.trim()) ? 0.5 : 1 }}>
                        Send to Artist
                      </button>
                      <button onClick={() => setFeedbackId(null)}
                        style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 12px', background: 'transparent', color: '#8a5c3a', border: '1px solid #d4c9bb', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {sub.feedbackAnswered && sub.adminFeedback && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: '6px 0 0', lineHeight: '1.5' }}>
                    <strong>Admin feedback sent:</strong> {sub.adminFeedback}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Feedback Panel ────────────────────────────────────────────────────────────
function FeedbackPanel() {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('all')

  useEffect(() => {
    async function load() {
      const q    = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }
    load()
  }, [])

  async function markRead(id) {
    await updateDoc(doc(db, 'feedback', id), { status: 'read' })
    setItems(prev => prev.map(f => f.id === id ? { ...f, status: 'read' } : f))
  }

  const filtered = filter === 'all' ? items : items.filter(f => f.type === filter)
  const newCount = items.filter(f => f.status === 'new').length

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {['all', 'bug', 'suggestion'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 border transition-colors ${filter === f ? 'bg-ink text-cream border-ink' : 'border-warm-gray-light text-warm-gray'}`}>
            {f === 'all' ? `All (${newCount} new)` : f}
          </button>
        ))}
      </div>

      {loading && <p className="font-mono text-[12px] text-warm-gray">Loading...</p>}
      {!loading && filtered.length === 0 && <p className="font-mono text-[12px] text-warm-gray">Nothing here yet.</p>}

      {filtered.map(item => (
        <div key={item.id} style={{
          border: '1px solid #e8e0d4', marginBottom: '12px', padding: '14px',
          background: item.status === 'new' ? '#faf8f4' : '#f5f2ee',
          opacity: item.status === 'read' ? 0.6 : 1,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: item.type === 'bug' ? '#b94040' : '#3a7a40' }}>
              {item.type === 'bug' ? '🐛 Bug' : '💡 Suggestion'}
              {item.status === 'new' && <span style={{ marginLeft: '8px', color: '#b97a30' }}>● New</span>}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a' }}>
              {item.email}
            </span>
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', margin: '0 0 10px', lineHeight: '1.6' }}>
            {item.message}
          </p>
          {item.status === 'new' && (
            <button onClick={() => markRead(item.id)}
              style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 10px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#8a5c3a' }}>
              Mark Read
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function CDOrdersPanel() {
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const q    = query(collection(db, 'quoteRequests'), orderBy('createdAt', 'desc'))
        const snap = await getDocs(q)
        setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  async function setStatus(id, status) {
    await updateDoc(doc(db, 'quoteRequests', id), { status })
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o))
  }

  const statusColor = { pending: '#b97a20', confirmed: '#1a5c1a', fulfilled: '#3a3a7a', cancelled: '#7a2020' }

  if (loading) return <p className="font-mono text-[12px] text-warm-gray">Loading...</p>
  if (orders.length === 0) return <p className="font-mono text-[12px] text-warm-gray text-center py-8">No CD quote requests yet.</p>

  return (
    <div className="flex flex-col gap-3">
      {orders.map(o => (
        <div key={o.id} style={{ border: '1px solid #e8e0d4', background: '#faf8f4' }}>
          {/* Header row */}
          <button
            onClick={() => setExpanded(expanded === o.id ? null : o.id)}
            className="w-full text-left px-4 py-3 flex items-start justify-between gap-2"
          >
            <div>
              <span className="font-mono text-[13px] text-ink">{o.name}</span>
              <span className="font-mono text-[11px] text-warm-gray ml-3">{o.qty} discs · ${o.estimatedTotal?.toFixed(2)}</span>
              <span className="font-mono text-[11px] text-warm-gray ml-3">{o.email}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: statusColor[o.status] || '#7a5030', border: `1px solid ${statusColor[o.status] || '#a08060'}`, padding: '2px 6px' }}>
                {o.status || 'pending'}
              </span>
              <span className="font-mono text-[11px] text-warm-gray">{expanded === o.id ? '▲' : '▼'}</span>
            </div>
          </button>

          {/* Expanded detail */}
          {expanded === o.id && (
            <div className="px-4 pb-4 flex flex-col gap-4 border-t border-warm-gray-light">
              {/* Track list + audio */}
              <div className="mt-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-earth mb-2">Track List</p>
                {(o.trackList || []).map((title, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-warm-gray-light/40">
                    <span className="font-mono text-[12px] text-ink">{i + 1}. {title}</span>
                    {o.audioFiles?.[i] && (
                      <a href={o.audioFiles[i].url} target="_blank" rel="noreferrer"
                        className="font-mono text-[10px] text-earth uppercase tracking-widest">
                        ↓ Download
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {/* Booklet images */}
              {o.bookletImages?.length > 0 && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-earth mb-2">Booklet Images</p>
                  <div className="grid grid-cols-4 gap-2">
                    {o.bookletImages.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={`Panel ${i + 1}`} className="w-full aspect-square object-cover border border-warm-gray-light" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {o.notes && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-earth mb-1">Notes</p>
                  <p className="font-mono text-[12px] text-ink/70 italic">"{o.notes}"</p>
                </div>
              )}

              {/* Pricing summary */}
              <div className="flex gap-4 font-mono text-[12px]">
                <span className="text-warm-gray">${o.pricePerDisc?.toFixed(2)}/disc</span>
                <span className="text-ink">Total: ${o.estimatedTotal?.toFixed(2)}</span>
                <span className="text-earth">Deposit: ${o.depositAmount?.toFixed(2)}</span>
              </div>

              {/* Status controls */}
              <div className="flex gap-2 flex-wrap">
                {['pending','confirmed','fulfilled','cancelled'].map(s => (
                  <button key={s} onClick={() => setStatus(o.id, s)}
                    className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 border transition-colors ${o.status === s ? 'bg-ink text-cream border-ink' : 'border-warm-gray-light text-warm-gray'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const OWNER_EMAIL = 'zionomari@artsaturated.com'


// ── Store Config Panel ────────────────────────────────────────────────────────
function StoreConfigPanel() {
  const [form,   setForm]   = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const inp = {
    fontFamily: 'monospace', fontSize: '14px', padding: '10px 12px',
    border: '1px solid #a08060', background: 'rgba(237,232,224,0.5)',
    color: '#1a1814', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  useEffect(() => {
    getDoc(doc(db, 'settings', 'storeConfig')).then(snap => {
      const d = snap.exists() ? snap.data() : {}
      setForm({
        commissionRate:       d.commissionRate       ?? 0.10,
        taxRate:              d.taxRate              ?? 0.07,
        tier0: d.shippingTiers?.[0] ?? 4.99,
        tier1: d.shippingTiers?.[1] ?? 7.99,
        tier2: d.shippingTiers?.[2] ?? 12.99,
        tier3: d.shippingTiers?.[3] ?? 18.99,
        localCommissionRate: d.localCommissionRate ?? 0.05,
        bundleDealEnabled:    d.bundleDeal?.enabled     ?? false,
        bundleDealMinQty:     d.bundleDeal?.minQty      ?? 2,
        bundleDealPct:        d.bundleDeal?.discountPct ?? 10,
        blogSubmissionFee:    d.blogSubmissionFee        ?? 0,
      })
    }).catch(() => setForm({ commissionRate: 0.10, localCommissionRate: 0.05, taxRate: 0.07, tier0: 4.99, tier1: 7.99, tier2: 12.99, tier3: 18.99, bundleDealEnabled: false, bundleDealMinQty: 2, bundleDealPct: 10, blogSubmissionFee: 0 }))
  }, [])

  async function handleSave() {
    if (!form) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'storeConfig'), {
        commissionRate:        Number(form.commissionRate),
        localCommissionRate:   Number(form.localCommissionRate),
        taxRate:               Number(form.taxRate),
        shippingTiers:         [Number(form.tier0), Number(form.tier1), Number(form.tier2), Number(form.tier3)],
        bundleDeal: {
          enabled:     !!form.bundleDealEnabled,
          minQty:      Number(form.bundleDealMinQty)  || 2,
          discountPct: Number(form.bundleDealPct)     || 10,
        },
        blogSubmissionFee: Number(form.blogSubmissionFee) || 0,
      }, { merge: true })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  if (!form) return <p className="font-mono text-[13px] text-warm-gray py-8">Loading…</p>

  return (
    <div style={{ maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Commission */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm-gray mb-4">Artist Commission</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number" min="0" max="1" step="0.01"
            value={form.commissionRate}
            onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value }))}
            style={{ ...inp, maxWidth: '100px' }}
          />
          <span className="font-mono text-[12px] text-warm-gray">
            ({Math.round(Number(form.commissionRate) * 100)}% of sale price)
          </span>
        </div>
        <p className="font-mono text-[11px] text-warm-gray mt-2">Enter as decimal — e.g. 0.10 for 10%</p>
      </div>

      {/* Local Drop-off Commission */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm-gray mb-4">Local Drop-off Commission</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number" min="0" max="1" step="0.01"
            value={form.localCommissionRate}
            onChange={e => setForm(f => ({ ...f, localCommissionRate: e.target.value }))}
            style={{ ...inp, maxWidth: '100px' }}
          />
          <span className="font-mono text-[12px] text-warm-gray">
            ({Math.round(Number(form.localCommissionRate) * 100)}% — artist drops off at store)
          </span>
        </div>
        <p className="font-mono text-[11px] text-warm-gray mt-2">Applied when a product is flagged "Local Drop-off" in the product form.</p>
      </div>


      {/* Tax */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm-gray mb-4">Tax Rate</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number" min="0" max="1" step="0.001"
            value={form.taxRate}
            onChange={e => setForm(f => ({ ...f, taxRate: e.target.value }))}
            style={{ ...inp, maxWidth: '100px' }}
          />
          <span className="font-mono text-[12px] text-warm-gray">
            ({Math.round(Number(form.taxRate) * 100 * 10) / 10}%)
          </span>
        </div>
        <p className="font-mono text-[11px] text-warm-gray mt-2">Enter as decimal — e.g. 0.07 for 7%</p>
      </div>

      {/* Shipping tiers */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm-gray mb-4">Shipping Tiers</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { field: 'tier0', label: '≤ 8 oz' },
            { field: 'tier1', label: '≤ 16 oz' },
            { field: 'tier2', label: '≤ 48 oz' },
            { field: 'tier3', label: '> 48 oz' },
          ].map(({ field, label }) => (
            <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
              <span className="font-mono text-[13px] text-ink">{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="font-mono text-[14px] text-warm-gray">$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ ...inp, maxWidth: '100px' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bundle Deal */}
      <div style={{ padding: '16px', border: '1px solid #a08060', background: 'rgba(237,232,224,0.3)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm-gray mb-4">Physical Media Bundle Deal</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, bundleDealEnabled: !f.bundleDealEnabled }))}
            style={{
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
              padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
              background:  form.bundleDealEnabled ? '#b97a30' : 'transparent',
              color:       form.bundleDealEnabled ? '#fff'    : '#8a5c3a',
              borderColor: form.bundleDealEnabled ? '#b97a30' : '#c8bfb0',
            }}
          >
            {form.bundleDealEnabled ? 'Enabled' : 'Disabled'}
          </button>
          <span className="font-mono text-[11px] text-warm-gray">Discount when buying multiple Physical Media items</span>
        </div>
        {form.bundleDealEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="font-mono text-[12px] text-ink" style={{ minWidth: '130px' }}>Min. qty to trigger</span>
              <input
                type="number" min="2" step="1"
                value={form.bundleDealMinQty}
                onChange={e => setForm(f => ({ ...f, bundleDealMinQty: e.target.value }))}
                style={{ ...inp, maxWidth: '80px' }}
              />
              <span className="font-mono text-[12px] text-warm-gray">items</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="font-mono text-[12px] text-ink" style={{ minWidth: '130px' }}>Discount</span>
              <input
                type="number" min="1" max="50" step="1"
                value={form.bundleDealPct}
                onChange={e => setForm(f => ({ ...f, bundleDealPct: e.target.value }))}
                style={{ ...inp, maxWidth: '80px' }}
              />
              <span className="font-mono text-[12px] text-warm-gray">%</span>
            </div>
            <p className="font-mono text-[11px]" style={{ color: '#b97a30' }}>
              Buy {form.bundleDealMinQty}+ Physical Media items → {form.bundleDealPct}% off Physical Media subtotal
            </p>
          </div>
        )}
      </div>

      {/* Art Saturated Magazine — blog submission fee */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm-gray mb-4">Magazine Article Submission Fee</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="font-mono text-[14px] text-warm-gray">$</span>
          <input
            type="number" min="0" step="0.01"
            value={form.blogSubmissionFee}
            onChange={e => setForm(f => ({ ...f, blogSubmissionFee: e.target.value }))}
            style={{ ...inp, maxWidth: '100px' }}
          />
        </div>
        <p className="font-mono text-[11px] text-warm-gray mt-2">
          Charged per article submitted to Art Saturated Magazine. Set to 0 for free submissions.
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-outline"
        style={{ opacity: saving ? 0.5 : 1 }}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Store Config'}
      </button>
    </div>
  )
}

// ── Album Preorders Panel ─────────────────────────────────────────────────────
const BLANK_ALBUM = {
  artistName: '', albumTitle: '', slug: '', price: '10',
  releaseDate: '', description: '', coverArt: '',
  digitalAvailable: true, physicalAvailable: true, pickupAvailable: true,
  active: true,
}

function AlbumPreordersPanel() {
  const [albums,   setAlbums]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [form,     setForm]     = useState(BLANK_ALBUM)
  const [editSlug, setEditSlug] = useState(null)   // null = new, string = editing
  const [saving,   setSaving]   = useState(false)
  const [view,     setView]     = useState('list')  // 'list' | 'form'
  const [coverBusy, setCoverBusy] = useState(false)
  const coverInputRef = useRef()

  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, 'albumPreorders'))
      const existing = snap.docs.map(d => ({ slug: d.id, ...d.data() }))

      // Seed Enigma preorder if it doesn't exist yet
      if (!snap.docs.find(d => d.id === 'enigma')) {
        const enigma = {
          artistName: 'Zionomari', albumTitle: 'Enigma', price: 10,
          releaseDate: 'May 2026', description: '',
          coverArt: '', digitalAvailable: true,
          physicalAvailable: true, pickupAvailable: true, active: true,
        }
        await setDoc(doc(db, 'albumPreorders', 'enigma'), enigma)
        existing.push({ slug: 'enigma', ...enigma })
      }

      setAlbums(existing)
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [])

  function openNew() { setForm(BLANK_ALBUM); setEditSlug(null); setView('form') }
  function openEdit(album) { setForm({ ...BLANK_ALBUM, ...album, price: String(album.price ?? 10) }); setEditSlug(album.slug); setView('form') }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverBusy(true)
    try {
      const imgRef = storageRef(storage, `albumPreorders/${form.slug || Date.now()}_cover`)
      const snap   = await uploadBytes(imgRef, file)
      const url    = await getDownloadURL(snap.ref)
      setForm(f => ({ ...f, coverArt: url }))
    } catch (err) { console.error(err) }
    finally { setCoverBusy(false); e.target.value = '' }
  }

  async function handleSave() {
    if (!form.artistName.trim() || !form.albumTitle.trim() || !form.slug.trim()) return
    setSaving(true)
    const data = {
      artistName:       form.artistName.trim(),
      albumTitle:       form.albumTitle.trim(),
      price:            parseFloat(form.price) || 10,
      releaseDate:      form.releaseDate.trim(),
      description:      form.description.trim(),
      coverArt:         form.coverArt.trim(),
      digitalAvailable:  form.digitalAvailable,
      physicalAvailable: form.physicalAvailable,
      pickupAvailable:   form.pickupAvailable,
      active:            form.active,
    }
    try {
      await setDoc(doc(db, 'albumPreorders', form.slug.trim()), data)
      const updated = { slug: form.slug.trim(), ...data }
      setAlbums(prev => editSlug
        ? prev.map(a => a.slug === editSlug ? updated : a)
        : [...prev, updated]
      )
      setView('list')
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  async function handleDelete(slug) {
    if (!window.confirm('Delete this preorder page?')) return
    await deleteDoc(doc(db, 'albumPreorders', slug))
    setAlbums(prev => prev.filter(a => a.slug !== slug))
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://artsaturated.com'

  if (view === 'form') return (
    <div style={{ maxWidth: '520px' }}>
      <button onClick={() => setView('list')} style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', color: '#7a5030', padding: 0, marginBottom: '24px' }}>
        ← Back
      </button>
      <h3 className="font-serif text-[1.2rem] font-normal mb-6">{editSlug ? 'Edit Preorder' : 'New Preorder'}</h3>

      {[
        { key: 'artistName',  label: 'Artist Name *',   placeholder: 'e.g. Zionomari' },
        { key: 'albumTitle',  label: 'Album Title *',   placeholder: 'e.g. Enigma' },
        { key: 'slug',        label: 'URL Slug *',      placeholder: 'e.g. enigma  →  /preorder/enigma', disabled: !!editSlug },
        { key: 'price',       label: 'Price ($) *',     placeholder: '10', type: 'number' },
        { key: 'releaseDate', label: 'Release Date',    placeholder: 'e.g. May 2026' },
        { key: 'description', label: 'Description',     placeholder: 'Short blurb shown on the page' },
        { key: 'coverArt',    label: 'Cover Art URL',   placeholder: 'or upload below' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: '14px' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '4px' }}>{f.label}</p>
          <input
            type={f.type || 'text'}
            placeholder={f.placeholder}
            value={form[f.key]}
            disabled={f.disabled}
            onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px', border: '1px solid #d4c9bb', background: f.disabled ? '#f0ece6' : '#faf8f4', color: '#1a1208', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      ))}

      {/* Cover art upload */}
      <div style={{ marginBottom: '20px' }}>
        {form.coverArt && <img src={form.coverArt} alt="cover" style={{ width: '120px', height: '120px', objectFit: 'cover', display: 'block', marginBottom: '8px', border: '1px solid #d4c9bb' }} />}
        <button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverBusy}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#1a1814' }}>
          {coverBusy ? 'Uploading…' : form.coverArt ? 'Replace Cover Art' : 'Upload Cover Art'}
        </button>
        <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} style={{ display: 'none' }} />
      </div>

      {/* Delivery toggles */}
      <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '10px' }}>Delivery Options</p>
      {[['digitalAvailable', 'Digital Download'], ['physicalAvailable', 'Ship Physical Copy'], ['pickupAvailable', 'Local Pickup']].map(([key, label]) => (
        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} style={{ accentColor: '#1a1208', width: '14px', height: '14px' }} />
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208' }}>{label}</span>
        </label>
      ))}

      {/* Active toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', cursor: 'pointer', marginTop: '8px' }}>
        <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} style={{ accentColor: '#1a1208', width: '14px', height: '14px' }} />
        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208' }}>Page active (public)</span>
      </label>

      <button onClick={handleSave} disabled={saving} className="btn-outline" style={{ display: 'inline-block' }}>
        {saving ? 'Saving…' : 'Save Preorder'}
      </button>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h3 className="font-serif text-[1.2rem] font-normal">Album Preorders</h3>
        <button onClick={openNew} className="btn-outline" style={{ display: 'inline-block' }}>+ New Preorder</button>
      </div>

      {loading ? <Spinner size={16} color="#3d2810" /> : albums.length === 0 ? (
        <p className="font-mono text-[13px] text-warm-gray">No album preorders set up yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {albums.map(album => (
            <div key={album.slug} style={{ padding: '16px', border: '1px solid #e8e0d4', background: '#faf8f4', display: 'flex', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
              {album.coverArt && <img src={album.coverArt} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: '200px' }}>
                <p style={{ fontFamily: 'serif', fontSize: '1rem', color: '#1a1814', margin: '0 0 2px' }}>{album.albumTitle}</p>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', margin: '0 0 6px' }}>{album.artistName} · ${album.price}</p>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a08060', margin: 0, letterSpacing: '0.06em' }}>
                  {origin}/preorder/{album.slug}
                  {!album.active && <span style={{ marginLeft: '8px', color: '#b94040' }}>— inactive</span>}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button onClick={() => openEdit(album)} style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '5px 12px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#1a1814' }}>Edit</button>
                <button onClick={() => handleDelete(album.slug)} style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '5px 12px', border: '1px solid #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#b94040' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Preorders Panel ───────────────────────────────────────────────────────────
function PreordersPanel() {
  const [preorders, setPreorders] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [subTab,    setSubTab]    = useState('all')

  // Cash preorder form
  const [search,    setSearch]    = useState('')
  const [results,   setResults]   = useState([])
  const [picked,    setPicked]    = useState(null)
  const [method,    setMethod]    = useState('digital')
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)

  // Inline edit
  const [editingId,     setEditingId]     = useState(null)
  const [editMethod,    setEditMethod]    = useState('digital')
  const [editStatus,    setEditStatus]    = useState('confirmed')

  useEffect(() => {
    getDocs(query(collection(db, 'preorders'), orderBy('paidAt', 'desc')))
      .then(snap => {
        setPreorders(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function searchUsers(q) {
    setSearch(q)
    if (q.length < 2) { setResults([]); return }
    const snap = await getDocs(collection(db, 'users'))
    const lower = q.toLowerCase()
    setResults(
      snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.email?.toLowerCase().includes(lower) || u.name?.toLowerCase().includes(lower))
        .slice(0, 6)
    )
  }

  async function recordCash() {
    if (!picked) return
    setSaving(true)
    const id = `cash_${Date.now()}_${picked.id}`
    await setDoc(doc(db, 'preorders', id), {
      uid:            picked.id,
      email:          picked.email || '',
      name:           picked.name  || '',
      albumSlug:      'enigma',
      albumName:      'Enigma',
      stripeSessionId: null,
      amount:          10,
      shippingMethod:  method,
      shippingAddress: null,
      paymentMethod:   'cash',
      status:          'confirmed',
      paidAt:          new Date(),
    })
    setPreorders(prev => [{
      id, uid: picked.id, email: picked.email, name: picked.name,
      albumName: 'Enigma', amount: 10, shippingMethod: method,
      paymentMethod: 'cash', status: 'confirmed', paidAt: { toDate: () => new Date() },
    }, ...prev])
    setPicked(null); setSearch(''); setResults([]); setMethod('digital')
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function markStatus(id, status) {
    await updateDoc(doc(db, 'preorders', id), { status })
    setPreorders(prev => prev.map(p => p.id === id ? { ...p, status } : p))
  }

  async function deletePreorder(id) {
    if (!window.confirm('Delete this preorder? This cannot be undone.')) return
    await deleteDoc(doc(db, 'preorders', id))
    setPreorders(prev => prev.filter(p => p.id !== id))
  }

  function startEdit(p) {
    setEditingId(p.id)
    setEditMethod(p.shippingMethod || 'digital')
    setEditStatus(p.status || 'confirmed')
  }

  async function saveEdit(id) {
    await updateDoc(doc(db, 'preorders', id), { shippingMethod: editMethod, status: editStatus })
    setPreorders(prev => prev.map(p => p.id === id ? { ...p, shippingMethod: editMethod, status: editStatus } : p))
    setEditingId(null)
  }

  const fmtDate = ts => {
    try { return (ts?.toDate?.() ?? new Date(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return '—' }
  }

  const statusColor = s => s === 'confirmed' ? '#2e7d32' : s === 'fulfilled' ? '#1565c0' : '#8a857d'

  const filtered = subTab === 'cash'   ? preorders.filter(p => p.paymentMethod === 'cash')
                 : subTab === 'online' ? preorders.filter(p => p.paymentMethod !== 'cash')
                 : preorders

  if (loading) return <p className="font-mono text-[12px] text-warm-gray">Loading…</p>

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[['all', `All (${preorders.length})`], ['online', 'Online'], ['cash', 'Cash']].map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key)}
            className="py-1.5 px-3 font-mono text-[10px] uppercase tracking-widest border transition-colors"
            style={{ background: subTab === key ? '#1a1208' : 'transparent', color: subTab === key ? '#f5f0e8' : '#9a9088', borderColor: subTab === key ? '#1a1208' : '#c8bfb0' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Cash preorder form */}
      <div style={{ border: '1px solid #d8d3cb', padding: '20px', marginBottom: '28px', background: '#faf8f4' }}>
        <p className="font-mono" style={{ fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8a857d', marginBottom: '14px' }}>
          Record Cash Preorder
        </p>
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => searchUsers(e.target.value)}
          className="font-mono"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #d8d3cb', background: '#fff', fontSize: '12px', marginBottom: '6px', boxSizing: 'border-box' }}
        />
        {results.length > 0 && !picked && (
          <div style={{ border: '1px solid #d8d3cb', background: '#fff', marginBottom: '10px' }}>
            {results.map(u => (
              <button key={u.id} onClick={() => { setPicked(u); setSearch(u.name || u.email); setResults([]) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #f0ebe3', background: 'transparent', cursor: 'pointer' }}>
                <span className="font-mono" style={{ fontSize: '11px', color: '#1a1814' }}>{u.name || '—'}</span>
                <span className="font-mono" style={{ fontSize: '10px', color: '#8a857d', marginLeft: '8px' }}>{u.email}</span>
              </button>
            ))}
          </div>
        )}
        {picked && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span className="font-mono" style={{ fontSize: '11px', color: '#2e7d32' }}>✓ {picked.name || picked.email}</span>
            <button onClick={() => { setPicked(null); setSearch('') }} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a857d', background: 'none', border: 'none', cursor: 'pointer' }}>× clear</button>
          </div>
        )}
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="font-mono" style={{ padding: '8px 10px', border: '1px solid #d8d3cb', background: '#fff', fontSize: '11px', marginBottom: '12px', width: '100%' }}>
          <option value="digital">Digital Download</option>
          <option value="ship">Ship Physical Copy (+$4.99)</option>
          <option value="pickup">Local Pickup</option>
        </select>
        <button onClick={recordCash} disabled={!picked || saving}
          className="btn-outline" style={{ width: '100%', padding: '10px', opacity: picked ? 1 : 0.5 }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Record Cash Preorder — $10'}
        </button>
      </div>

      {/* Preorder list */}
      {filtered.length === 0 ? (
        <p className="font-mono text-[12px] text-warm-gray">No preorders yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(p => (
            <div key={p.id} style={{ border: '1px solid #e0dbd3', padding: '14px 16px', background: '#faf8f4' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <p className="font-mono" style={{ fontSize: '12px', color: '#1a1814', marginBottom: '2px' }}>{p.name || p.email || '—'}</p>
                  <p className="font-mono" style={{ fontSize: '10px', color: '#8a857d' }}>{p.email}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="font-mono" style={{ fontSize: '12px', color: '#1a1814' }}>${p.amount?.toFixed(2) ?? '10.00'}</p>
                  <p className="font-mono" style={{ fontSize: '10px', color: '#8a857d' }}>{fmtDate(p.paidAt)}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '10px', padding: '2px 7px', border: '1px solid #e0dbd3', color: '#8a857d' }}>
                  {p.shippingMethod === 'ship' ? 'Ship' : p.shippingMethod === 'pickup' ? 'Pickup' : 'Digital'}
                </span>
                <span className="font-mono" style={{ fontSize: '10px', padding: '2px 7px', border: `1px solid ${statusColor(p.status)}`, color: statusColor(p.status) }}>
                  {p.status}
                </span>
                {p.paymentMethod === 'cash' && (
                  <span className="font-mono" style={{ fontSize: '10px', padding: '2px 7px', border: '1px solid #b97a30', color: '#b97a30' }}>Cash</span>
                )}
                {p.status === 'confirmed' && editingId !== p.id && (
                  <button onClick={() => markStatus(p.id, 'fulfilled')}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '2px 10px', border: '1px solid #1565c0', color: '#1565c0', background: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
                    Mark Fulfilled
                  </button>
                )}
                {editingId !== p.id && (
                  <button onClick={() => startEdit(p)}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '2px 10px', border: '1px solid #a08060', color: '#a08060', background: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
                    Edit
                  </button>
                )}
                {editingId !== p.id && (
                  <button onClick={() => deletePreorder(p.id)}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '2px 10px', border: '1px solid #c0392b', color: '#c0392b', background: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
                    Delete
                  </button>
                )}
              </div>

              {/* Inline edit row */}
              {editingId === p.id && (
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #e0dbd3', paddingTop: '12px' }}>
                  <select value={editMethod} onChange={e => setEditMethod(e.target.value)}
                    className="font-mono" style={{ padding: '5px 8px', border: '1px solid #d8d3cb', fontSize: '11px', background: '#fff' }}>
                    <option value="digital">Digital</option>
                    <option value="ship">Ship</option>
                    <option value="pickup">Pickup</option>
                  </select>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                    className="font-mono" style={{ padding: '5px 8px', border: '1px solid #d8d3cb', fontSize: '11px', background: '#fff' }}>
                    <option value="confirmed">Confirmed</option>
                    <option value="fulfilled">Fulfilled</option>
                  </select>
                  <button onClick={() => saveEdit(p.id)}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '5px 12px', border: '1px solid #2e7d32', color: '#2e7d32', background: 'none', cursor: 'pointer' }}>
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)}
                    style={{ fontFamily: 'monospace', fontSize: '10px', padding: '5px 12px', border: '1px solid #d8d3cb', color: '#8a857d', background: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Users Panel ───────────────────────────────────────────────────────────────
function UsersPanel() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then(snap => {
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return !q || u.email?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q)
  })

  const fmtDate = ts => {
    try { return (ts?.toDate?.() ?? new Date(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return '—' }
  }

  const roleColor = r => r === 'creator' ? '#1565c0' : '#2e7d32'

  if (loading) return <p className="font-mono text-[12px] text-warm-gray">Loading…</p>

  return (
    <div>
      <p className="font-mono" style={{ fontSize: '11px', color: '#8a857d', marginBottom: '16px' }}>
        {users.length} account{users.length !== 1 ? 's' : ''} on the site
      </p>
      <input
        type="text"
        placeholder="Search by name or email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="font-mono"
        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d8d3cb', background: '#fff', fontSize: '12px', marginBottom: '16px', boxSizing: 'border-box' }}
      />
      {filtered.length === 0 ? (
        <p className="font-mono text-[12px] text-warm-gray">No users found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(u => {
            const roles = Array.isArray(u.accountType)
              ? u.accountType
              : u.accountType === 'both' ? ['collector', 'creator'] : [u.accountType || 'collector']
            const isCreator = roles.includes('creator')
            return (
            <div key={u.id}
              onClick={() => isCreator && navigate(`/artists/${u.id}`)}
              style={{ border: '1px solid #e0dbd3', padding: '12px 16px', background: '#faf8f4', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', cursor: isCreator ? 'pointer' : 'default', transition: 'background 0.15s' }}
              onMouseEnter={e => { if (isCreator) e.currentTarget.style.background = '#f0ebe0' }}
              onMouseLeave={e => { if (isCreator) e.currentTarget.style.background = '#faf8f4' }}
              title={isCreator ? 'View artist profile' : undefined}
            >
              <div>
                <p className="font-mono" style={{ fontSize: '12px', color: '#1a1814', marginBottom: '2px' }}>
                  {u.name || '—'}
                  {isCreator && <span style={{ fontFamily: 'monospace', fontSize: '9px', color: '#1565c0', marginLeft: '8px', letterSpacing: '0.1em' }}>→ PROFILE</span>}
                </p>
                <p className="font-mono" style={{ fontSize: '10px', color: '#8a857d' }}>{u.email}</p>
                {u.instagram && (
                  <p className="font-mono" style={{ fontSize: '10px', color: '#8a857d', marginTop: '2px' }}>@{u.instagram}</p>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: '4px' }}>
                  {roles.map(r => (
                    <span key={r} className="font-mono" style={{ fontSize: '10px', padding: '2px 7px', border: `1px solid ${roleColor(r)}`, color: roleColor(r) }}>
                      {r}
                    </span>
                  ))}
                </div>
                {u.lifetimeSpend > 0 && (
                  <p className="font-mono" style={{ fontSize: '10px', color: '#a08060' }}>${u.lifetimeSpend?.toFixed(2)} spent</p>
                )}
                {u.createdAt && (
                  <p className="font-mono" style={{ fontSize: '10px', color: '#b5b0a8' }}>Joined {fmtDate(u.createdAt)}</p>
                )}
              </div>
            </div>
          )})}

        </div>
      )}
    </div>
  )
}

// ── Workshop RSVP Admin Panel ─────────────────────────────────────────────────
function WorkshopPanel() {
  const [rsvps, setRsvps] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [addEmail, setAddEmail] = useState('')
  const [addName, setAddName] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [rsvpSnap, bookingSnap] = await Promise.all([
        getDocs(query(collection(db, 'workshopRsvps'), orderBy('submittedAt', 'desc'))),
        getDocs(query(collection(db, 'workshopBookings'), orderBy('paidAt', 'desc'))).catch(() => ({ docs: [] })),
      ])
      setRsvps(rsvpSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setBookings(bookingSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) { console.error('WorkshopPanel load:', err) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addAttendee() {
    const email = addEmail.trim()
    const name = addName.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    setAdding(true)
    try {
      await addDoc(collection(db, 'workshopRsvps'), {
        name: name || email.split('@')[0],
        email,
        uid: null,
        submittedAt: new Date(),
        addedByAdmin: true,
      })
      setAddEmail('')
      setAddName('')
      await load()
    } catch (err) { console.error('Add attendee error:', err) }
    setAdding(false)
  }

  function groupByEmail(list) {
    const m = new Map()
    for (const r of list) {
      const key = String(r.email || '').trim().toLowerCase()
      if (!key) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(r)
    }
    return m
  }
  function earliestOf(group) {
    return group.reduce((a, b) => {
      const ta = a.submittedAt?.toMillis?.() ?? Infinity
      const tb = b.submittedAt?.toMillis?.() ?? Infinity
      return tb < ta ? b : a
    })
  }

  async function removeByEmail(ids, label) {
    const n = ids.length
    const extra = n > 1 ? ` and ${n - 1} duplicate ${n - 1 === 1 ? 'entry' : 'entries'}` : ''
    if (!window.confirm(`Remove ${label}${extra}? This cannot be undone.`)) return
    try {
      const batch = writeBatch(db)
      ids.forEach(id => batch.delete(doc(db, 'workshopRsvps', id)))
      await batch.commit()
      await load()
    } catch (err) { console.error('Remove RSVP error:', err) }
  }

  async function removeDuplicates() {
    const toDelete = []
    for (const group of groupByEmail(rsvps).values()) {
      if (group.length < 2) continue
      const keep = earliestOf(group)
      group.forEach(g => { if (g.id !== keep.id) toDelete.push(g.id) })
    }
    if (toDelete.length === 0) return
    if (!window.confirm(`Remove ${toDelete.length} duplicate RSVP${toDelete.length === 1 ? '' : 's'}? The earliest entry per email is kept.`)) return
    try {
      const batch = writeBatch(db)
      toDelete.forEach(id => batch.delete(doc(db, 'workshopRsvps', id)))
      await batch.commit()
      await load()
    } catch (err) { console.error('Remove duplicates error:', err) }
  }

  const fmtDate = (ts) => {
    if (!ts) return '—'
    const d = ts.toDate?.() ?? new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) return <p className="font-mono text-[11px] text-warm-gray">Loading workshop RSVPs...</p>

  // Dedupe by email for display; flag repeats and keep the earliest as primary
  const uniqueRsvps = []
  for (const group of groupByEmail(rsvps).values()) {
    const primary = earliestOf(group)
    uniqueRsvps.push({ ...primary, _count: group.length, _ids: group.map(g => g.id) })
  }
  uniqueRsvps.sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0))
  const dupCount = rsvps.length - uniqueRsvps.length

  return (
    <div>
      {/* Add workshop attendee manually */}
      <div className="border border-dashed border-earth/40 p-4 mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-earth mb-3">Add Attendee</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            placeholder="Name (optional)"
            className="border border-warm-gray-light px-3 py-2 font-mono text-[12px] text-ink bg-cream focus:border-ink focus:outline-none"
            style={{ minWidth: '120px', flex: '1 1 120px' }}
          />
          <input
            type="email"
            value={addEmail}
            onChange={e => setAddEmail(e.target.value)}
            placeholder="attendee@email.com"
            className="border border-warm-gray-light px-3 py-2 font-mono text-[12px] text-ink bg-cream focus:border-ink focus:outline-none"
            style={{ minWidth: '180px', flex: '2 1 180px' }}
          />
          <button
            onClick={addAttendee}
            disabled={adding || !addEmail.trim()}
            className="font-mono text-[10px] uppercase tracking-widest border border-ink px-4 py-2 text-ink hover:bg-ink hover:text-cream transition-colors disabled:opacity-50"
          >
            {adding ? '...' : 'Add'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">
          RSVPs ({uniqueRsvps.length}{dupCount > 0 ? ` · ${dupCount} duplicate${dupCount === 1 ? '' : 's'} hidden` : ''})
        </p>
        {dupCount > 0 && (
          <button
            onClick={removeDuplicates}
            className="font-mono text-[9px] uppercase tracking-widest border border-warm-gray-light px-3 py-1.5 text-warm-gray hover:border-red-600 hover:text-red-600 transition-colors"
          >
            Remove {dupCount} duplicate{dupCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {uniqueRsvps.length === 0 && (
        <p className="font-mono text-[12px] text-warm-gray">No RSVPs yet.</p>
      )}

      <div className="flex flex-col gap-3">
        {uniqueRsvps.map(r => (
          <div key={r.id} className="border border-warm-gray-light p-4" style={{ background: '#faf8f4' }}>
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-serif text-ink text-[15px]">
                  {r.name || '(no name)'}
                  {r._count > 1 && (
                    <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-red-600 border border-red-600 px-1.5 py-0.5 align-middle">
                      {r._count}× dup
                    </span>
                  )}
                </p>
                <p className="font-mono text-[11px] text-warm-gray">{r.email}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] text-warm-gray">{fmtDate(r.submittedAt)}</p>
                {r.addedByAdmin && (
                  <p className="font-mono text-[9px] uppercase tracking-widest text-earth mt-1">Added by you</p>
                )}
                <button
                  onClick={() => removeByEmail(r._ids, r.name || r.email)}
                  className="block ml-auto font-mono text-[9px] uppercase tracking-widest text-warm-gray hover:text-red-600 transition-colors mt-1"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 1:1 Deposit Bookings */}
      <div className="border-t border-warm-gray-light mt-8 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-4">
          1:1 Session Deposits ({bookings.length})
        </p>
        {bookings.length === 0 && (
          <p className="font-mono text-[12px] text-warm-gray">No 1:1 deposits yet.</p>
        )}
        <div className="flex flex-col gap-3">
          {bookings.map(b => (
            <div key={b.id} className="border border-warm-gray-light p-4" style={{ background: '#f5f0e8' }}>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-serif text-ink text-[15px]">{b.name || '(no name)'}</p>
                  <p className="font-mono text-[11px] text-warm-gray">{b.email}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[11px] text-earth">${b.amount || 25} deposit</p>
                  <p className="font-mono text-[10px] text-warm-gray">{fmtDate(b.paidAt)}</p>
                  <p className="font-mono text-[10px] text-ink">{b.status === 'deposit_paid' ? 'Awaiting confirmation' : b.status}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, signInWithGoogle, logOut } = useAuth()
  const isOwner  = user?.email === OWNER_EMAIL
  const tab    = searchParams.get('tab') || 'products'
  function setTab(t) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true }) }
  const [showMoreTabs, setShowMoreTabs] = useState(false)
  const [view, setView]           = useState('list')
  const [products, setProducts]   = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [archiveItems, setArchiveItems] = useState([])
  const [form, setForm]           = useState(BLANK)
  const [editId,  setEditId]      = useState(null)   // Firestore doc id when editing
  const [draftBanner, setDraftBanner] = useState(false)
  const [draftSaved, setDraftSaved]   = useState('')
  const [publishBusy,  setPublishBusy]  = useState(false)
  const [publishError, setPublishError] = useState('')
  const [audioBusy,    setAudioBusy]    = useState(false)
  const [releasePct,   setReleasePct]   = useState(null)   // upload % while a paid download uploads
  const [releaseError, setReleaseError] = useState('')
  const [releaseList,  setReleaseList]  = useState(null)   // null = picker closed, [] = empty
  const [releaseListBusy, setReleaseListBusy] = useState(false)
  const [cropPending,  setCropPending]  = useState(null)  // { file, preview, title? }
  const [cropSlotIdx,  setCropSlotIdx]  = useState(0)
  const [photoSlots,   setPhotoSlots]   = useState([{ preview: null, url: null, uploading: false }])
  const slotRefs   = useRef([])
  const bulkInputRef = useRef(null)
  const imgUploading = photoSlots.some(s => s.uploading)
  const draftTimer = useRef()
  const [productSubTab, setProductSubTab] = useState('active')  // 'active' | 'inactive' | 'bucket'
  const [submitMode,    setSubmitMode]    = useState('publish')  // 'publish' | 'bucket'
  const [bucketBusy,    setBucketBusy]    = useState(false)
  const [qfText,        setQfText]        = useState('')
  const [qfOpen,        setQfOpen]        = useState(false)
  const [qfLoading,     setQfLoading]     = useState(false)
  const [qfError,       setQfError]       = useState(null)
  const [discogsQuery,  setDiscogsQuery]  = useState('')
  const [discogsBusy,   setDiscogsBusy]   = useState(false)
  const [discogsMsg,    setDiscogsMsg]    = useState(null)
  const [scannerOpen,   setScannerOpen]   = useState(false)
  const [batchBusy,     setBatchBusy]     = useState(false)
  const [batchError,    setBatchError]    = useState(null)
  const [batchResult,   setBatchResult]   = useState(null)   // { groups, ungrouped, notes, urls }
  const [batchUsed,     setBatchUsed]     = useState([])      // indexes of groups already pulled into the form

  async function handleDiscogsLookup(overrideValue) {
    const q = (overrideValue ?? discogsQuery).trim()
    if (!q) return
    setDiscogsBusy(true); setDiscogsMsg(null)
    try {
      // Barcodes are mostly digits; otherwise treat as catalog # / free text.
      const isBarcode = /^[0-9\s-]{8,}$/.test(q)
      const res = await runAiJob('discogs', isBarcode ? { barcode: q.replace(/[\s-]/g, '') } : { query: q })
      if (!res || res.found === false) { setDiscogsMsg({ ok: false, text: 'No match on Discogs — try the catalog # or artist + title.' }); return }

      // Metadata auto-fill only — pricing is MANUAL. Zion prices each copy off the
      // live Discogs marketplace listing (link surfaced below), not an auto-suggestion.
      // Note: price is intentionally never touched here.
      setForm(f => ({
        ...f,
        category:   f.category || 'Physical Media',
        name:       res.name       || f.name,
        artist:     res.artist     || f.artist,
        albumTitle: res.albumTitle || f.albumTitle,
        genre:      res.genre      || f.genre,
        year:       res.year != null ? String(res.year) : f.year,
        styles:     (Array.isArray(res.styles) && res.styles.length) ? res.styles : f.styles,
      }))

      // Build the Discogs links from the release id and pass along a light
      // marketplace-floor reference (context for manual pricing — not auto-filled).
      const pr = res.pricing
      setDiscogsMsg({
        ok:             true,
        text:           `Matched: ${res.name}${res.year ? ` (${res.year})` : ''}${res.label ? ` · ${res.label}` : ''}`,
        releaseUrl:     res.discogsId ? `https://www.discogs.com/release/${res.discogsId}` : null,
        marketplaceUrl: res.discogsId ? `https://www.discogs.com/sell/release/${res.discogsId}` : null,
        numForSale:     pr?.numForSale  ?? null,
        lowestPrice:    pr?.lowestPrice ?? null,
      })
    } catch (err) {
      setDiscogsMsg({ ok: false, text: err.message || 'Lookup failed.' })
    } finally { setDiscogsBusy(false) }
  }

  function handleBarcodeDetect(value) {
    setScannerOpen(false)
    setDiscogsQuery(value)
    handleDiscogsLookup(value)
  }

  async function handleQuickFill() {
    const imageUrl = photoSlots[0]?.url || null
    if (!qfText.trim() && !imageUrl) {
      setQfError('Add some notes or upload a photo first.')
      return
    }
    setQfLoading(true)
    setQfError(null)
    try {
      const data = await runAiJob('quickfill', { text: qfText.trim() || undefined, imageUrl: imageUrl || undefined })
      // Merge suggestions into form — only overwrite blank fields
      setForm(f => ({
        ...f,
        name:        data.name        || f.name,
        description: data.description || f.description,
        price:       data.price       != null ? String(data.price) : f.price,
        category:    data.category    || f.category,
        condition:   data.condition   || f.condition,
        medium:      data.medium      || f.medium,
        artist:      data.artist      || f.artist,
        albumTitle:  data.albumTitle  || f.albumTitle,
        genre:       data.genre       || f.genre,
        size:        data.size        || f.size,
        weightOz:    data.weightOz    != null ? String(data.weightOz) : f.weightOz,
      }))
      setQfOpen(false)
      setQfText('')
    } catch (err) {
      setQfError(err.message || 'Suggestion failed.')
    } finally {
      setQfLoading(false)
    }
  }

  // ── AI Batch sort — one pass over every uploaded photo ─────────────
  // Sends all uploaded photos to the model, which groups fronts/backs/details
  // by item and drafts a listing per group. Zion then pulls each group into the
  // form one at a time with "Use → fill form". Snapshots the URL list so the
  // group indexes stay valid even after the form's photoSlots get replaced.
  async function handleBatchSort() {
    const urls = photoSlots.map(s => s.url).filter(Boolean)
    if (urls.length < 2) { setBatchError('Upload at least 2 photos first (multiple items to sort).'); return }
    setBatchBusy(true); setBatchError(null); setBatchResult(null); setBatchUsed([])
    try {
      const res = await runAiJob('batch', { imageUrls: urls })
      setBatchResult({ ...res, urls })
      if (!res.groups?.length) setBatchError('No groups came back — try clearer photos or sort manually.')
    } catch (err) {
      setBatchError(err.message || 'Batch sort failed.')
    } finally { setBatchBusy(false) }
  }

  // Pull one batch group into the add form: set the fields it identified and
  // load just that group's photos into the slots, ready to review + publish.
  function applyBatchGroup(group, gIdx) {
    const urls = batchResult?.urls || []
    const groupUrls = (group.imageIndexes || [])
      .map(i => urls[i])
      .filter(Boolean)
    if (groupUrls.length) {
      setPhotoSlots(groupUrls.map(u => ({ preview: u, url: u, uploading: false })))
    }
    setForm(f => {
      // Associated artists become extra style/metadata tags (merged, de-duped).
      const extra = Array.isArray(group.associatedArtists) ? group.associatedArtists.filter(Boolean) : []
      const styles = Array.from(new Set([...(Array.isArray(f.styles) ? f.styles : []), ...extra]))
      return {
        ...f,
        category:   group.category   || f.category || 'Physical Media',
        name:       group.name       || f.name,
        artist:     group.artist     || f.artist,
        albumTitle: group.albumTitle || f.albumTitle,
        genre:      group.genre      || f.genre,
        year:       group.year != null ? String(group.year) : f.year,
        condition:  group.condition  || f.condition,
        styles,
      }
    })
    setBatchUsed(u => u.includes(gIdx) ? u : [...u, gIdx])
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Load products from Firestore ───────────────────────────────────
  useEffect(() => {
    if (tab === 'products' && view === 'list') {
      setProductsLoading(true)
      fetchAllProducts()
        .then(setProducts)
        .catch(() => {})
        .finally(() => setProductsLoading(false))
      fetchArchive().then(setArchiveItems).catch(() => {})
    }
  }, [tab, view])

  // ── Auto-save draft while typing (new listings only, no image data) ─
  useEffect(() => {
    if (view !== 'add') return
    setDraftSaved('saving')
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      saveDraft(form)
      setDraftSaved('saved')
      setTimeout(() => setDraftSaved(''), 2000)
    }, 1500)
    return () => clearTimeout(draftTimer.current)
  }, [form, view])

  // ── Physical Media: auto-generate name from Artist + Album ──────────
  // Only fires when both are non-empty; only overwrites if name is blank
  // or already matches the previous auto-pattern (so manual edits survive).
  const prevAutoName = useRef('')
  useEffect(() => {
    if (form.category !== 'Physical Media') return
    const auto = (form.artist?.trim() && form.albumTitle?.trim())
      ? `${form.artist.trim()} - ${form.albumTitle.trim()}`
      : ''
    if (!auto) return
    setForm(f => {
      if (f.name === '' || f.name === prevAutoName.current) {
        prevAutoName.current = auto
        return { ...f, name: auto }
      }
      prevAutoName.current = auto
      return f
    })
  }, [form.artist, form.albumTitle, form.category]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Image picker — multi-slot, crop first then upload ─────────────
  function handleSlotChange(slotIdx, e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCropSlotIdx(slotIdx)
    setCropPending({ file, preview: URL.createObjectURL(file) })
    e.target.value = ''
  }

  // ── Bulk picker — select many photos from the gallery at once ──────
  // Uploads them straight into open slots (no per-image crop); edit/crop
  // individual ones afterward with the ✏ button. Caps at MAX_PHOTOS total.
  async function handleBulkPick(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    setPublishError('')

    const isArt = form.category === 'Art'
    const baseSlots = photoSlots.filter(s => s.url || s.uploading)
    const room = Math.max(0, MAX_PHOTOS - baseSlots.length)
    if (room === 0) { setPublishError(`Already at ${MAX_PHOTOS} photos — remove one to add more.`); return }

    const batch    = files.slice(0, room)
    const startIdx = baseSlots.length
    const placeholders = batch.map(f => ({ preview: URL.createObjectURL(f), url: null, uploading: true }))
    setPhotoSlots([...baseSlots, ...placeholders])

    await Promise.all(batch.map(async (file, k) => {
      const idx = startIdx + k
      let toUpload = file
      if (isArt) {
        try {
          const blob = await applyWatermark(file)
          toUpload = new File([blob], file.name, { type: blob.type })
        } catch (err) { console.error('Watermark failed, uploading original', err) }
      }
      // Compress before upload — saves data, keeps quality.
      toUpload = await compressImage(toUpload)
      try {
        const url = await uploadProductImage(toUpload)
        setPhotoSlots(slots => { const n = [...slots]; if (n[idx]) n[idx] = { preview: url, url, uploading: false }; return n })
      } catch (err) {
        console.error('Bulk image upload failed', err)
        setPhotoSlots(slots => { const n = [...slots]; if (n[idx]) n[idx] = { preview: null, url: null, uploading: false }; return n })
        setPublishError('Some images failed to upload — try again.')
      }
    }))

    if (files.length > room) {
      setPublishError(`Added ${room} photo${room !== 1 ? 's' : ''} (${MAX_PHOTOS} max). ${files.length - room} not added.`)
    }
  }

  async function handleCropConfirm(croppedFile, croppedPreview) {
    setCropPending(null)
    const idx = cropSlotIdx

    let fileToUpload   = croppedFile
    let previewToShow  = croppedPreview

    if (form.category === 'Art') {
      try {
        const blob     = await applyWatermark(croppedFile)
        fileToUpload   = new File([blob], croppedFile.name, { type: blob.type })
        previewToShow  = URL.createObjectURL(blob)
      } catch (err) {
        console.error('Watermark failed, uploading original', err)
      }
    }

    setPhotoSlots(slots => {
      const next = [...slots]
      next[idx] = { preview: previewToShow, url: null, uploading: true }
      return next
    })
    try {
      const url = await uploadProductImage(await compressImage(fileToUpload))
      setPhotoSlots(slots => {
        const next = [...slots]
        next[idx] = { preview: url, url, uploading: false }
        return next
      })
    } catch (err) {
      console.error('Image upload failed', err)
      setPhotoSlots(slots => {
        const next = [...slots]
        next[idx] = { preview: null, url: null, uploading: false }
        return next
      })
      setPublishError('Image upload failed — try again.')
    }
  }

  // ── Re-edit existing slot: open CropModal with the existing URL directly ─────
  // crossOrigin='anonymous' in CropModal lets canvas drawImage work with remote URLs
  function openSlotEditor(slotIdx) {
    const slot = photoSlots[slotIdx]
    if (!slot?.url) return
    setCropSlotIdx(slotIdx)
    setCropPending({ file: null, preview: slot.url, title: 'Edit Photo' })
  }

  function addPhotoSlot() {
    setPhotoSlots(s => s.length < MAX_PHOTOS ? [...s, { preview: null, url: null, uploading: false }] : s)
  }

  function removePhotoSlot(idx) {
    setPhotoSlots(slots => {
      const next = slots.filter((_, i) => i !== idx)
      return next.length === 0 ? [{ preview: null, url: null, uploading: false }] : next
    })
  }

  function openAdd() {
    const draft = loadDraft()
    if (draft && draft.name) {
      setForm({ ...BLANK, ...draft })
      setDraftBanner(true)
    } else {
      setForm(BLANK)
      setDraftBanner(false)
    }
    setEditId(null)
    setPublishError('')
    setReleaseError('')
    setReleaseList(null)
    setPhotoSlots([{ preview: null, url: null, uploading: false }])
    setView('add')
  }

  function discardDraft() {
    clearDraft()
    setForm(BLANK)
    setDraftBanner(false)
  }

  function openEdit(product) {
    setForm({
      ...BLANK,
      ...product,
      details: Array.isArray(product.details) ? product.details.join(', ') : (product.details || ''),
    })
    setEditId(product.id)
    setPublishError('')
    setReleaseError('')
    setReleaseList(null)
    const existingURLs = product.imageURLs?.length
      ? product.imageURLs
      : [product.imageURL || product.image].filter(Boolean)
    setPhotoSlots(
      existingURLs.length > 0
        ? existingURLs.map(u => ({ preview: u, url: u, uploading: false }))
        : [{ preview: null, url: null, uploading: false }]
    )
    setView('edit')
  }

  async function handleDelete(product) {
    if (!window.confirm('Delete this product?')) return
    await deleteProduct(product.id)
    setProducts(prev => prev.filter(p => p.id !== product.id))
  }

  async function handleToggleSold(product) {
    const newSold = !product.sold
    await updateProduct(product.id, { ...product, sold: newSold })
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, sold: newSold } : p))
  }

  async function handleArchive(product) {
    await updateProduct(product.id, { ...product, active: false, inBucket: false })
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, active: false, inBucket: false } : p))
  }

  async function handleRestore(product) {
    await updateProduct(product.id, { ...product, active: true, inBucket: false })
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, active: true, inBucket: false } : p))
  }

  async function handleAddToBucket(product) {
    await updateProduct(product.id, { ...product, active: false, inBucket: true })
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, active: false, inBucket: true } : p))
  }

  async function handleRemoveFromBucket(product) {
    await updateProduct(product.id, { ...product, active: false, inBucket: false })
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, active: false, inBucket: false } : p))
  }

  async function handlePublishSingle(product) {
    await updateProduct(product.id, { ...product, active: true, inBucket: false })
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, active: true, inBucket: false } : p))
  }

  async function handlePublishAllBucket() {
    const bucket = products.filter(p => p.inBucket)
    if (!bucket.length) return
    setBucketBusy(true)
    try {
      await Promise.all(bucket.map(p => updateProduct(p.id, { ...p, active: true, inBucket: false })))
      setProducts(prev => prev.map(p => p.inBucket ? { ...p, active: true, inBucket: false } : p))
    } finally {
      setBucketBusy(false)
    }
  }

  // ── Paid download (digital delivery) ──────────────────────────────────────
  // Uploads land in releases/, which only the owner can read. The product stores
  // the path, never a URL — the confirmation email carries a signed link.
  async function handleReleaseUpload(file) {
    if (!file) return
    setReleaseError('')
    setReleasePct(0)
    try {
      const path = await uploadRelease(file, form.slug || form.name, setReleasePct)
      setForm(f => ({ ...f, downloadPath: path }))
      setReleaseList(null)
    } catch (err) {
      console.error(err)
      setReleaseError(err?.code === 'storage/unauthorized'
        ? 'Storage refused the upload — only the shop owner account can add release files.'
        : 'Upload failed — check your connection and try again.')
    } finally {
      setReleasePct(null)
    }
  }

  async function toggleReleasePicker() {
    if (releaseList) { setReleaseList(null); return }
    setReleaseListBusy(true)
    setReleaseError('')
    try {
      setReleaseList(await listReleases())
    } catch (err) {
      console.error(err)
      setReleaseError('Could not list uploaded files.')
    } finally {
      setReleaseListBusy(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (imgUploading) { setPublishError('Image is still uploading — wait a moment.'); return }
    if (releasePct !== null) { setPublishError('Download file is still uploading — wait a moment.'); return }
    setPublishBusy(true)
    setPublishError('')
    try {
      const slug    = editId ? form.slug : slugify(form.name)
      const details = typeof form.details === 'string'
        ? form.details.split(',').map(d => d.trim()).filter(Boolean)
        : form.details || []
      const imageURLs = photoSlots.map(s => s.url).filter(Boolean)
      const goToBucket = !editId && submitMode === 'bucket'
      const data = {
        ...form,
        slug,
        price:     parseFloat(form.price) || 0,
        details,
        image:     imageURLs[0] || null,
        imageURL:  imageURLs[0] || null,
        imageURLs,
        active:    goToBucket ? false : (editId ? form.active : true),
        inBucket:  goToBucket ? true  : (editId ? (form.inBucket || false) : false),
        _imgFile:  undefined,
        ...(form.category === 'Art' && user?.uid ? { artistUid: user.uid } : {}),
      }
      const toCollection = !editId && submitMode === 'collection'
      if (editId) {
        await updateProduct(editId, { ...data, id: editId })
      } else if (toCollection) {
        await addArchiveItem(data)
      } else {
        await addProduct(data)
      }
      clearDraft()
      setDraftBanner(false)
      setSubmitMode('publish')
      setProductSubTab(toCollection ? 'collection' : goToBucket ? 'bucket' : 'active')
      setView('list')
    } catch (err) {
      console.error(err)
      setPublishError('Save failed — check your connection and try again.')
    } finally {
      setPublishBusy(false)
    }
  }

  // ── Login / access gate ────────────────────────────────────────────
  if (!isOwner) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-6">
        <div className="text-center" style={{ maxWidth: '340px' }}>
          <p className="font-serif text-[1.8rem] mb-2">Admin</p>
          <p className="font-mono text-[12px] text-warm-gray mb-8 tracking-wide">
            Art Saturated — Owner access only
          </p>

          {!user ? (
            // Not signed in — show Google button
            <button
              onClick={() => signInWithGoogle().catch(() => {})}
              className="btn-outline w-full flex items-center justify-center gap-3"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
          ) : (
            // Signed in but wrong account
            <div className="flex flex-col gap-4">
              <p className="font-mono text-[12px] text-warm-gray">
                Signed in as <span className="text-ink">{user.email}</span>
              </p>
              <p className="font-mono text-[11px] text-warm-gray">
                This account doesn't have admin access. Sign in with the owner account.
              </p>
              <button
                onClick={() => logOut().catch(() => {})}
                className="btn-outline w-full"
              >
                Sign Out & Try Again
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  // ── Product form (add / edit) ──────────────────────────────────────
  if (view === 'add' || view === 'edit') {
    return (
      <main className="min-h-screen bg-cream px-4 pt-6 pb-20">
        {cropPending && (
          <CropModal
            file={cropPending.file}
            preview={cropPending.preview}
            title={cropPending.title}
            onConfirm={handleCropConfirm}
            onCancel={() => setCropPending(null)}
          />
        )}
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-serif text-[1.4rem]">
              {view === 'add' ? 'New Listing' : 'Edit Listing'}
            </h1>
            <div className="flex items-center gap-3">
              {draftSaved === 'saving' && (
                <span className="font-mono text-[10px] text-warm-gray uppercase tracking-widest animate-pulse">saving…</span>
              )}
              {draftSaved === 'saved' && (
                <span className="font-mono text-[10px] text-warm-gray uppercase tracking-widest">draft saved ✓</span>
              )}
              <button
                onClick={() => { clearDraft(); setDraftBanner(false); setView('list') }}
                className="font-mono text-[11px] text-warm-gray uppercase tracking-widest"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Draft restore banner */}
          {draftBanner && (
            <div style={{ background: '#f2ebe0', border: '1px solid #d4c9bb', padding: '12px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <p className="font-mono text-[11px] text-ink">Draft restored — pick up where you left off.</p>
              <button
                type="button"
                onClick={discardDraft}
                className="font-mono text-[10px] uppercase tracking-widest text-warm-gray"
              >
                Discard draft
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            {/* Listing mode — presets the form for the workflow */}
            {view === 'add' && (() => {
              const mode = form.category === 'Physical Media' ? 'record'
                         : form.category === 'Art'            ? 'art'
                         : 'single'
              const MODES = [
                { key: 'single', label: 'Single Item',    apply: { category: '',               type: '' } },
                { key: 'record', label: 'Record / Vinyl', apply: { category: 'Physical Media',  type: 'Vinyl' } },
                { key: 'art',    label: 'Art',            apply: { category: 'Art',             type: '' } },
              ]
              const hint = mode === 'record'
                ? 'Record mode — use the Discogs lookup + bulk photo upload below to list fast. Up to 10 photos, auto-compressed.'
                : mode === 'art'
                ? 'Art mode — photos auto-watermark on upload.'
                : 'Pick a mode to surface the right fields, or set the category below.'
              return (
                <div>
                  <label className="eyebrow mb-2 block">Listing mode</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {MODES.map(m => (
                      <button
                        key={m.key} type="button"
                        onClick={() => setForm(f => ({ ...f, ...m.apply, medium: '', series: '' }))}
                        style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px', border: '1px solid', borderColor: mode === m.key ? '#1a1208' : '#c8bfb0', background: mode === m.key ? '#1a1208' : 'transparent', color: mode === m.key ? '#f5f2ec' : '#8a7560', cursor: 'pointer' }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#9a7050', marginTop: '6px' }}>{hint}</p>
                </div>
              )
            })()}

            {/* Photos — multi-slot grid */}
            {(() => {
              const labelKey = form.category === 'Physical Media' ? (form.type || '') : form.category
              const labels = SLOT_LABELS[labelKey] || Array.from({ length: 6 }, (_, i) => i === 0 ? 'Main Photo' : `Photo ${i + 1}`)
              return (
                <div>
                  <label className="eyebrow mb-2 block">Photos</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {photoSlots.map((slot, i) => (
                      <div key={i}>
                        <p style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.07em', color: i === 0 ? '#5a3820' : '#9a7050', marginBottom: '4px' }}>
                          {labels[i] || `Photo ${i + 1}`}{i === 0 ? ' *' : ''}
                        </p>
                        {slot.preview ? (
                          <div style={{ background: '#e8e0d4', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ aspectRatio: '1', overflow: 'hidden', position: 'relative' }}>
                              <img src={slot.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              {slot.uploading && (
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,24,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontFamily: 'monospace', fontSize: '8px', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Uploading…</span>
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', borderTop: '1px solid #d4c9bb' }}>
                              <button type="button" onClick={() => slotRefs.current[i]?.click()} style={{ flex: 1, fontFamily: 'monospace', fontSize: '9px', padding: '5px 0', background: 'transparent', border: 'none', borderRight: '1px solid #d4c9bb', cursor: 'pointer', color: '#8a5c3a', letterSpacing: '0.04em' }}>↺</button>
                              <button
                                type="button"
                                onClick={() => openSlotEditor(i)}
                                title="Edit brightness & crop"
                                style={{ flex: 1, fontFamily: 'monospace', fontSize: '9px', padding: '5px 0', background: 'transparent', border: 'none', borderRight: '1px solid #d4c9bb', cursor: 'pointer', color: '#b97a30', letterSpacing: '0.04em' }}
                              >✏</button>
                              <button type="button" onClick={() => removePhotoSlot(i)} style={{ flex: 1, fontFamily: 'monospace', fontSize: '9px', padding: '5px 0', background: 'transparent', border: 'none', cursor: 'pointer', color: '#b94040' }}>✕</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: '#edebe6', borderRadius: '2px', overflow: 'hidden', border: `1px dashed ${i === 0 ? '#b49068' : '#ccc4b8'}` }}>
                            <button
                              type="button"
                              onClick={() => slotRefs.current[i]?.click()}
                              style={{ width: '100%', aspectRatio: '1', background: 'transparent', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: '4px' }}
                            >
                              <span style={{ fontSize: '1.2rem' }}>📷</span>
                              <span style={{ fontFamily: 'monospace', fontSize: '8px', color: i === 0 ? '#8a5c3a' : '#9a7050', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {i === 0 ? 'Required' : 'Optional'}
                              </span>
                            </button>
                            {i > 0 && (
                              <div style={{ borderTop: '1px solid #d4c9bb' }}>
                                <button type="button" onClick={() => removePhotoSlot(i)} style={{ width: '100%', fontFamily: 'monospace', fontSize: '9px', padding: '5px 0', background: 'transparent', border: 'none', cursor: 'pointer', color: '#b94040' }}>✕ Remove</button>
                              </div>
                            )}
                          </div>
                        )}
                        <input
                          ref={el => { slotRefs.current[i] = el }}
                          type="file"
                          accept="image/*"
                          onChange={e => handleSlotChange(i, e)}
                          style={{ display: 'none' }}
                        />
                      </div>
                    ))}
                    {photoSlots.length < MAX_PHOTOS && (
                      <button
                        type="button"
                        onClick={addPhotoSlot}
                        style={{ aspectRatio: '1', background: 'transparent', border: '1px dashed #ccc4b8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: '4px', borderRadius: '2px' }}
                      >
                        <span style={{ fontSize: '1.2rem', color: '#9a7050' }}>+</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '8px', color: '#9a7050', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Add Photo</span>
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => bulkInputRef.current?.click()}
                      disabled={imgUploading}
                      style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 14px', border: '1px solid #b49068', background: 'rgba(180,144,104,0.08)', color: '#7a5030', cursor: imgUploading ? 'default' : 'pointer', opacity: imgUploading ? 0.5 : 1 }}
                    >
                      ⊞ Add multiple from gallery
                    </button>
                    <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#9a7050' }}>
                      First photo = main image · up to {MAX_PHOTOS} · auto-compressed
                    </span>
                  </div>
                  <input
                    ref={bulkInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleBulkPick}
                    style={{ display: 'none' }}
                  />

                  {/* ── AI Batch sort — group a pile of photos into per-item listings ── */}
                  {photoSlots.filter(s => s.url).length >= 2 && (
                    <div style={{ marginTop: '10px', border: '1px solid #7a8a5a', background: 'rgba(122,138,90,0.06)', padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={handleBatchSort}
                          disabled={batchBusy || imgUploading}
                          style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px', background: batchBusy ? '#c4b4a0' : '#5e7038', color: '#f2ebe0', border: 'none', cursor: (batchBusy || imgUploading) ? 'default' : 'pointer', opacity: imgUploading ? 0.5 : 1 }}
                        >
                          {batchBusy ? 'Sorting…' : '🪄 AI Batch sort'}
                        </button>
                        <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#6a7a4a' }}>
                          Groups all {photoSlots.filter(s => s.url).length} uploaded photos by item — then pull each into the form.
                        </span>
                      </div>

                      {batchError && (
                        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: '8px 0 0' }}>{batchError}</p>
                      )}

                      {batchResult && (
                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {batchResult.notes && (
                            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#6a7a4a', margin: 0, fontStyle: 'italic' }}>{batchResult.notes}</p>
                          )}
                          {batchResult.groups.map((g, gi) => {
                            const used = batchUsed.includes(gi)
                            const lowConf = g.confidence === 'low' || g.flag
                            const thumbs = (g.imageIndexes || []).map(i => batchResult.urls[i]).filter(Boolean)
                            return (
                              <div key={gi} style={{ border: `1px solid ${lowConf ? '#c08a30' : '#c8bfb0'}`, background: lowConf ? 'rgba(192,138,48,0.06)' : '#faf7f1', padding: '10px', opacity: used ? 0.55 : 1 }}>
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                  {thumbs.map((u, ti) => (
                                    <img key={ti} src={u} alt="" loading="lazy" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '2px', border: '1px solid #d4c9bb' }} />
                                  ))}
                                </div>
                                <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#3a2a18', margin: '0 0 2px', fontWeight: 600 }}>
                                  {g.name || [g.artist, g.albumTitle].filter(Boolean).join(' — ') || `Item ${gi + 1}`}
                                </p>
                                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#7a6a55', margin: 0 }}>
                                  {[g.category, g.genre, g.year, g.condition].filter(Boolean).join(' · ') || '—'}
                                  {Array.isArray(g.associatedArtists) && g.associatedArtists.length > 0 && ` · +${g.associatedArtists.join(', ')}`}
                                </p>
                                {lowConf && (
                                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a06a10', margin: '4px 0 0' }}>
                                    ⚠ {g.flag || 'Low confidence — double-check this one.'}
                                  </p>
                                )}
                                <button
                                  type="button"
                                  onClick={() => applyBatchGroup(g, gi)}
                                  disabled={used}
                                  style={{ marginTop: '8px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 14px', background: used ? 'transparent' : '#5e7038', color: used ? '#7a8a5a' : '#f2ebe0', border: used ? '1px solid #b4bf9a' : 'none', cursor: used ? 'default' : 'pointer' }}
                                >
                                  {used ? '✓ Pulled into form' : 'Use → fill form'}
                                </button>
                              </div>
                            )
                          })}
                          {batchResult.ungrouped.length > 0 && (
                            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a06a10', margin: 0 }}>
                              ⚠ {batchResult.ungrouped.length} photo{batchResult.ungrouped.length !== 1 ? 's' : ''} couldn't be placed — sort {batchResult.ungrouped.length !== 1 ? 'them' : 'it'} manually.
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => { setBatchResult(null); setBatchUsed([]); setBatchError(null) }}
                            style={{ alignSelf: 'flex-start', fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 10px', background: 'transparent', border: '1px solid #c8bfb0', color: '#8a7560', cursor: 'pointer' }}
                          >
                            ✕ Clear results
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── Discogs lookup — records / physical media only ── */}
            {form.category === 'Physical Media' && (
            <div style={{ border: '1px solid #6a6aaf', background: 'rgba(106,106,175,0.05)', padding: '12px 14px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#5a5a9a', margin: '0 0 8px' }}>
                ⌕ Discogs lookup
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="text" value={discogsQuery}
                  onChange={e => setDiscogsQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleDiscogsLookup() } }}
                  placeholder="Barcode, catalog #, or artist + title"
                  style={{ flex: 1, minWidth: '200px', fontFamily: 'monospace', fontSize: '12px', padding: '8px 10px', border: '1px solid #c4b4a0', background: 'transparent', color: 'inherit', outline: 'none' }}
                />
                <button type="button" onClick={() => handleDiscogsLookup()} disabled={discogsBusy || !discogsQuery.trim()}
                  style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px', background: '#5a5a9a', color: '#f5f2ec', border: 'none', cursor: discogsBusy || !discogsQuery.trim() ? 'default' : 'pointer', opacity: discogsBusy || !discogsQuery.trim() ? 0.5 : 1 }}>
                  {discogsBusy ? 'Looking…' : 'Look up'}
                </button>
                <button type="button" onClick={() => setScannerOpen(true)} disabled={discogsBusy}
                  title="Scan barcode with camera"
                  style={{ fontFamily: 'monospace', fontSize: '14px', padding: '8px 14px', background: 'rgba(90,90,154,0.15)', color: '#7a7ac0', border: '1px solid #5a5a9a', cursor: discogsBusy ? 'default' : 'pointer', opacity: discogsBusy ? 0.5 : 1 }}>
                  📷
                </button>
              </div>
              {discogsMsg && (
                <div style={{ margin: '8px 0 0' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: discogsMsg.ok ? '#3a7a40' : '#b94040', margin: 0 }}>{discogsMsg.text}</p>

                  {discogsMsg.ok && (discogsMsg.marketplaceUrl || discogsMsg.releaseUrl) && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                      {discogsMsg.marketplaceUrl && (
                        <a href={discogsMsg.marketplaceUrl} target="_blank" rel="noreferrer"
                          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 14px', background: '#5a5a9a', color: '#f5f2ec', textDecoration: 'none' }}>
                          ⌕ Price off Discogs listings ↗
                        </a>
                      )}
                      {discogsMsg.releaseUrl && (
                        <a href={discogsMsg.releaseUrl} target="_blank" rel="noreferrer"
                          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 12px', background: 'transparent', color: '#5a5a9a', border: '1px solid #5a5a9a', textDecoration: 'none' }}>
                          Release page ↗
                        </a>
                      )}
                      {(discogsMsg.numForSale != null || discogsMsg.lowestPrice != null) && (
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a7ac0' }}>
                          {discogsMsg.numForSale != null ? `${discogsMsg.numForSale} for sale` : ''}
                          {discogsMsg.numForSale != null && discogsMsg.lowestPrice != null ? ' · ' : ''}
                          {discogsMsg.lowestPrice != null ? `from $${discogsMsg.lowestPrice.toFixed(2)}` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            {scannerOpen && (
              <BarcodeScanner
                onDetect={handleBarcodeDetect}
                onClose={() => setScannerOpen(false)}
              />
            )}

            {/* ── AI Quick Fill ── */}
            <div style={{ border: '1px solid #c4b4a0', background: 'rgba(185,122,48,0.04)' }}>
              <button
                type="button"
                onClick={() => { setQfOpen(o => !o); setQfError(null) }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#b97a30' }}
              >
                <span>✦ AI Quick Fill</span>
                <span style={{ fontSize: '10px', opacity: 0.6 }}>{qfOpen ? '▲ close' : '▼ open'}</span>
              </button>
              {qfOpen && (
                <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', margin: 0, lineHeight: 1.5 }}>
                    Describe the item in rough notes. If you've uploaded a photo above, it'll be analyzed too. Fills in blank fields only.
                  </p>
                  <textarea
                    value={qfText}
                    onChange={e => setQfText(e.target.value)}
                    placeholder="e.g. vintage sony walkman from 80s, plays cassettes, grey, great condition, found at estate sale, prob worth around $45"
                    rows={3}
                    style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px 10px', border: '1px solid #c4b4a0', background: 'transparent', color: 'inherit', outline: 'none', resize: 'vertical', width: '100%', boxSizing: 'border-box', lineHeight: 1.5 }}
                  />
                  {qfError && (
                    <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: 0 }}>{qfError}</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={handleQuickFill}
                      disabled={qfLoading}
                      style={{ fontFamily: 'monospace', fontSize: '11px', padding: '7px 18px', background: qfLoading ? '#c4b4a0' : '#b97a30', color: '#f2ebe0', border: 'none', cursor: qfLoading ? 'not-allowed' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                    >
                      {qfLoading ? 'Thinking…' : 'Suggest Fields'}
                    </button>
                    {photoSlots[0]?.url && (
                      <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#3a7a40' }}>✓ Photo will be included</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Name */}
            <div className="flex flex-col gap-1">
              <label className="eyebrow">
                Name
                {form.category === 'Physical Media' && form.artist && form.albumTitle && (
                  <span className="font-mono text-[10px] text-warm-gray ml-2 normal-case tracking-normal">auto-filled from Artist + Album</span>
                )}
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                placeholder={form.category === 'Physical Media' ? 'Auto-filled once Artist + Album Title are set' : 'Product name'}
              />
            </div>

            {/* Category */}
            <div className="flex flex-col gap-1">
              <label className="eyebrow">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value, medium: '', series: '' })}
                className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
              >
                {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c}>{c}</option>
                ))}
                <option value="Mystery">Mystery</option>
              </select>
            </div>

            {/* Crate size (Mystery only) */}
            {form.category === 'Mystery' && (
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Crate Size</label>
                <select
                  value={form.crateSize || 1}
                  onChange={e => setForm({ ...form, crateSize: Number(e.target.value) })}
                  className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                >
                  <option value={1}>1 — Single Mystery Record</option>
                  <option value={3}>3 — 3-Record Mystery Crate</option>
                  <option value={5}>5 — 5-Record Mystery Crate</option>
                  <option value={8}>8 — 8-Record Mystery Crate</option>
                </select>
                <p className="font-mono text-[10px] text-warm-gray mt-1">
                  Determines which tier appears on the Mystery page. Set price accordingly.
                </p>
              </div>
            )}

            {/* Medium (Art only) */}
            {form.category === 'Art' && (
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Medium</label>
                <div className="flex flex-wrap gap-2 mb-1">
                  {MEDIUMS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm({ ...form, medium: form.medium === m ? '' : m })}
                      style={{
                        fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
                        padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                        background: form.medium === m ? '#1a1208' : 'transparent',
                        color:      form.medium === m ? '#f5f0e8' : '#8a5c3a',
                        borderColor: form.medium === m ? '#1a1208' : '#c8bfb0',
                      }}
                    >{m}</button>
                  ))}
                </div>
                <input
                  type="text"
                  value={form.medium}
                  onChange={e => setForm({ ...form, medium: e.target.value })}
                  placeholder="Or type your own medium…"
                  className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                />
              </div>
            )}

            {/* Series (Get On The Flora only) */}
            {form.category === 'Get On The Flora' && (
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Series</label>
                <select
                  value={form.series}
                  onChange={(e) => setForm({ ...form, series: e.target.value })}
                  className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                >
                  <option value="">— Select —</option>
                  {SERIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}

            {/* Type (Vintage Tech only) */}
            {form.category === 'Vintage Tech' && (
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                >
                  <option value="">— Select —</option>
                  {VINTAGE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
            )}

            {/* Type + tags (Physical Media only) */}
            {form.category === 'Physical Media' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Format</label>
                  <div className="flex flex-wrap gap-2">
                    {MEDIA_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm({ ...form, type: form.type === t ? '' : t })}
                        style={{
                          fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
                          padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                          background: form.type === t ? '#1a1208' : 'transparent',
                          color:      form.type === t ? '#f5f0e8' : '#8a5c3a',
                          borderColor: form.type === t ? '#1a1208' : '#c8bfb0',
                        }}
                      >{t}</button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Tags</label>
                  <div className="flex flex-wrap gap-2">
                    {[['newArrival', 'New Arrival'], ['localLegend', 'Local Legend']].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setForm({ ...form, [key]: !form[key] })}
                        style={{
                          fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
                          padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                          background: form[key] ? '#b97a30' : 'transparent',
                          color:      form[key] ? '#fff' : '#8a5c3a',
                          borderColor: form[key] ? '#b97a30' : '#c8bfb0',
                        }}
                      >{label}</button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Genre</label>
                  <select
                    value={form.genre || ''}
                    onChange={e => setForm({ ...form, genre: e.target.value })}
                    className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                  >
                    <option value="">— Select genre —</option>
                    {VINYL_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Artist</label>
                  <input
                    type="text"
                    value={form.artist || ''}
                    onChange={e => setForm({ ...form, artist: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="e.g. Miles Davis"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Album Title</label>
                  <input
                    type="text"
                    value={form.albumTitle || ''}
                    onChange={e => setForm({ ...form, albumTitle: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="e.g. Kind of Blue"
                  />
                </div>

                {/* Cross-listings — same album in other formats */}
                <div className="flex flex-col gap-2">
                  <label className="eyebrow">Also Available As (Cross-Format)</label>
                  <p className="font-mono text-[11px] text-warm-gray leading-relaxed">
                    Link the same album in other formats. Customers will see "Also available as" on the product page.
                  </p>
                  {(form.crossListings || []).map((cl, i) => (
                    <div key={i} className="flex items-center justify-between border border-warm-gray-light px-3 py-2">
                      <span className="font-mono text-[12px] text-ink">
                        <span className="text-warm-gray mr-2">{cl.type || 'Unknown'}</span>{cl.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, crossListings: form.crossListings.filter((_, idx) => idx !== i) })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b94040', fontFamily: 'monospace', fontSize: '13px', padding: '0 4px' }}
                      >✕</button>
                    </div>
                  ))}
                  <select
                    onChange={e => {
                      const id = e.target.value
                      if (!id) return
                      const p = products.find(p => p.id === id)
                      if (!p) return
                      if ((form.crossListings || []).some(cl => cl.id === id)) return
                      setForm({ ...form, crossListings: [...(form.crossListings || []), { id: p.id, name: p.name, type: p.type || p.category, slug: p.slug }] })
                      e.target.value = ''
                    }}
                    style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px 12px', border: '1px dashed #d4c9bb', background: 'transparent', color: '#8a5c3a', cursor: 'pointer' }}
                  >
                    <option value="">+ Add cross-format version…</option>
                    {products
                      .filter(p => p.category === 'Physical Media' && p.id !== editId)
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.type ? ` (${p.type})` : ''}
                        </option>
                      ))
                    }
                  </select>
                </div>

                {/* Digital / Stream Link — generates QR code on product page */}
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Digital / Stream Link (optional)</label>
                  <input
                    type="url"
                    value={form.digitalUrl || ''}
                    onChange={e => setForm({ ...form, digitalUrl: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="https://bandcamp.com/... or Spotify / Apple Music link"
                  />
                  <p className="font-mono text-[11px] text-warm-gray">Shown as a scannable QR code + link on the product page.</p>
                </div>

                {/* Deposit / pre-order option */}
                <div className="border border-warm-gray-light p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, acceptsDeposit: !form.acceptsDeposit })}
                      style={{
                        fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
                        padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                        background: form.acceptsDeposit ? '#b97a30' : 'transparent',
                        color:      form.acceptsDeposit ? '#fff' : '#8a5c3a',
                        borderColor: form.acceptsDeposit ? '#b97a30' : '#c8bfb0',
                      }}
                    >
                      Accept Deposit / Pre-Order
                    </button>
                    <p className="font-mono text-[10px] text-warm-gray">
                      Shows "Reserve with Deposit" button on product page
                    </p>
                  </div>
                  {form.acceptsDeposit && (
                    <div className="flex flex-col gap-1">
                      <label className="eyebrow">Deposit Amount ($)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={form.depositAmount}
                        onChange={e => setForm({ ...form, depositAmount: e.target.value })}
                        className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                        placeholder="e.g. 25.00"
                      />
                      {form.depositAmount && form.price && (
                        <p className="font-mono text-[11px] text-warm-gray mt-0.5">
                          Balance due on completion: ${(parseFloat(form.price) - parseFloat(form.depositAmount)).toFixed(2)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Garment type + sizes (Clothing only) */}
            {form.category === 'Clothing' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Garment Type</label>
                  <div className="flex flex-wrap gap-2">
                    {['Tops', 'Bottoms', 'Accessories', 'Custom / One of One'].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm({ ...form, garmentType: form.garmentType === t ? '' : t })}
                        style={{
                          fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
                          padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                          background: form.garmentType === t ? '#1a1208' : 'transparent',
                          color:      form.garmentType === t ? '#f5f0e8' : '#8a5c3a',
                          borderColor: form.garmentType === t ? '#1a1208' : '#c8bfb0',
                        }}
                      >{t}</button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Available Sizes</label>
                  <div className="flex flex-wrap gap-2">
                    {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'].map(sz => {
                      const sel = (form.sizes || []).includes(sz)
                      return (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => {
                            const cur = form.sizes || []
                            setForm({ ...form, sizes: sel ? cur.filter(s => s !== sz) : [...cur, sz] })
                          }}
                          style={{
                            fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
                            padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                            background: sel ? '#b97a30' : 'transparent',
                            color:      sel ? '#fff' : '#8a5c3a',
                            borderColor: sel ? '#b97a30' : '#c8bfb0',
                          }}
                        >{sz}</button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Creator / Designer</label>
                  <input
                    type="text"
                    value={form.creator || ''}
                    onChange={e => setForm({ ...form, creator: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="Artist / designer name"
                  />
                </div>
              </>
            )}

            {/* Price + Stock row */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="eyebrow">Price ($)</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1 w-28">
                <label className="eyebrow">Qty in Stock</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                  placeholder="∞"
                />
              </div>
            </div>

            {/* Art-only fields */}
            {form.category === 'Art' && (
              <>
                {/* Size + Year row */}
                <div className="flex gap-3">
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="eyebrow">Size</label>
                    <input
                      type="text"
                      value={form.size}
                      onChange={(e) => setForm({ ...form, size: e.target.value })}
                      className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                      placeholder='e.g. 8×11 in'
                    />
                  </div>
                  <div className="flex flex-col gap-1 w-28">
                    <label className="eyebrow">Year</label>
                    <input
                      type="number"
                      min="1900"
                      max={new Date().getFullYear()}
                      value={form.year}
                      onChange={(e) => setForm({ ...form, year: e.target.value })}
                      className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                      placeholder="2024"
                    />
                  </div>
                </div>

                {/* Style / Genre */}
                <StylePicker
                  selected={form.styles || []}
                  onChange={(styles) => setForm({ ...form, styles })}
                />

                {/* Estimated Weight */}
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Est. Weight (oz) — for shipping</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.weightOz}
                    onChange={(e) => setForm({ ...form, weightOz: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="e.g. 8"
                  />
                  {form.weightOz && (() => {
                    const oz = parseFloat(form.weightOz)
                    const lbs = (oz / 16).toFixed(2)
                    const tier = oz <= 8  ? { label: '✓ Tier 1',  rate: '$4.99',  color: '#3a7a40' }
                               : oz <= 16 ? { label: '· Tier 2',  rate: '$7.99',  color: '#8a6a30' }
                               : oz <= 48 ? { label: '· Tier 3',  rate: '$12.99', color: '#8a6a30' }
                               : oz <= 1120 ? { label: '· Tier 4', rate: '$18.99', color: '#b97a30' }
                               : { label: '⚠ Exceeds USPS max (70 lbs)', rate: '—', color: '#b94040' }
                    return (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <p className="font-mono text-[11px] text-warm-gray">≈ {lbs} lbs</p>
                        <p className="font-mono text-[11px]" style={{ color: tier.color }}>
                          {tier.label} — est. {tier.rate} shipping
                        </p>
                      </div>
                    )
                  })()}
                </div>

                {/* Track previews — public clips played on the product page */}
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Track Previews (optional)</label>
                  <p className="font-mono text-[11px] text-warm-gray mb-1">
                    Public clips anyone can play on the listing. Upload short previews, not full tracks.
                  </p>

                  {(form.previewTracks || []).length > 0 && (
                    <ul className="flex flex-col gap-2 mb-2" style={{ listStyle: 'none', padding: 0 }}>
                      {form.previewTracks.map((t, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <input
                            value={t.title}
                            onChange={e => setForm({
                              ...form,
                              previewTracks: form.previewTracks.map((x, j) =>
                                j === i ? { ...x, title: e.target.value } : x),
                            })}
                            className="flex-1 border border-warm-gray-light bg-transparent px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
                            placeholder={`Track ${i + 1} title`}
                          />
                          <audio src={t.url} controls preload="none" style={{ height: 32, maxWidth: 180 }} />
                          <button
                            type="button"
                            onClick={() => setForm({
                              ...form,
                              previewTracks: form.previewTracks.filter((_, j) => j !== i),
                            })}
                            className="font-mono text-[11px] px-2 py-1 border border-warm-gray-light text-warm-gray hover:text-ink"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    disabled={audioBusy}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || [])
                      if (!files.length) return
                      setAudioBusy(true)
                      setPublishError('')
                      try {
                        const uploaded = []
                        for (const file of files) {
                          if (file.size > 20 * 1024 * 1024) {
                            throw new Error(`"${file.name}" is over 20 MB — upload a shorter preview clip.`)
                          }
                          const url = await uploadProductAudio(file)
                          uploaded.push({ title: file.name.replace(/\.[^.]+$/, ''), url })
                        }
                        setForm(f => ({ ...f, previewTracks: [...(f.previewTracks || []), ...uploaded] }))
                      } catch (err) {
                        setPublishError(err.message || 'Audio upload failed.')
                      } finally {
                        setAudioBusy(false)
                        e.target.value = ''
                      }
                    }}
                    className="font-mono text-[12px] text-warm-gray"
                  />
                  {audioBusy && <p className="font-mono text-[11px] text-earth">Uploading audio…</p>}
                </div>
              </>
            )}

            {/* Paid download — any category can be a digital good */}
            <div className="flex flex-col gap-1">
              <label className="eyebrow">Paid Download (optional)</label>
              <p className="font-mono text-[11px] text-warm-gray mb-1">
                The file a buyer receives after paying. Private — nothing links to it publicly;
                the confirmation email carries a 30-day link. Leave empty for physical-only items.
              </p>

              {form.downloadPath ? (
                <div className="flex items-center gap-2 border border-warm-gray-light px-3 py-2">
                  <span className="font-mono text-[12px] text-ink flex-1" style={{ wordBreak: 'break-all' }}>
                    {form.downloadPath}
                  </span>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, downloadPath: '' }))}
                    className="font-mono text-[11px] px-2 py-1 border border-warm-gray-light text-warm-gray hover:text-ink"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    disabled={releasePct !== null}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      handleReleaseUpload(file)
                    }}
                    className="font-mono text-[12px] text-warm-gray"
                  />
                  <button
                    type="button"
                    onClick={toggleReleasePicker}
                    disabled={releaseListBusy || releasePct !== null}
                    className="font-mono text-[11px] px-3 py-2 border border-warm-gray-light text-warm-gray hover:text-ink self-start"
                  >
                    {releaseListBusy ? 'Loading…' : releaseList ? 'Hide uploaded files' : 'Or pick a file already uploaded…'}
                  </button>

                  {releaseList && (
                    releaseList.length === 0 ? (
                      <p className="font-mono text-[11px] text-warm-gray">No files uploaded yet.</p>
                    ) : (
                      <ul className="flex flex-col gap-1" style={{ listStyle: 'none', padding: 0, maxHeight: 240, overflowY: 'auto' }}>
                        {releaseList.map(f => (
                          <li key={f.path}>
                            <button
                              type="button"
                              onClick={() => { setForm(fm => ({ ...fm, downloadPath: f.path })); setReleaseList(null) }}
                              className="w-full flex items-center gap-2 border border-warm-gray-light px-3 py-2 text-left hover:border-ink"
                              style={{ background: 'transparent', cursor: 'pointer' }}
                            >
                              <span className="font-mono text-[12px] text-ink flex-1" style={{ wordBreak: 'break-all' }}>{f.name}</span>
                              {f.size != null && (
                                <span className="font-mono text-[11px] text-warm-gray">{formatBytes(f.size)}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              )}

              {releasePct !== null && (
                <p className="font-mono text-[11px] text-earth">Uploading download… {releasePct}%</p>
              )}
              {releaseError && (
                <p className="font-mono text-[11px] text-red-500">{releaseError}</p>
              )}
            </div>

            {/* Condition — shown on all listings */}
            <div className="flex flex-col gap-1">
              <label className="eyebrow">Condition</label>
              <select
                value={form.condition || ''}
                onChange={e => setForm({ ...form, condition: e.target.value })}
                className="border border-warm-gray-light bg-cream px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
              >
                {CONDITION_OPTIONS.map(c => (
                  <option key={c} value={c}>{c === '' ? '— Select —' : c}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1">
              <label className="eyebrow">Description</label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink resize-none"
                placeholder="Describe the item..."
              />
            </div>

            {/* Details */}
            <div className="flex flex-col gap-1">
              <label className="eyebrow">Details (comma separated)</label>
              <input
                type="text"
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                placeholder="Material, Condition, Edition"
              />
            </div>

            {/* Art flags — Print / Original / One of a Kind */}
            {form.category === 'Art' && (
              <div className="flex flex-col gap-3">
                <p className="eyebrow">Listing Type</p>
                {[
                  ['isPrint',    'Print',       'A reproduced print of the original work'],
                  ['isOriginal', 'Original',    'The one-of-a-kind original piece'],
                  ['unique',     'One of a Kind','Unique — only one exists'],
                ].map(([key, label, hint]) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="w-5 h-5 accent-ink mt-0.5 shrink-0"
                    />
                    <span>
                      <span className="font-mono text-[13px] block">{label}</span>
                      <span className="font-mono text-[11px] text-warm-gray">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* One of a kind (+ Local Pickup Only for plants) for non-Art categories */}
            {form.category !== 'Art' && (
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.unique}
                    onChange={(e) => setForm({ ...form, unique: e.target.checked })}
                    className="w-5 h-5 accent-ink"
                  />
                  <span className="font-mono text-[13px]">One of a kind</span>
                </label>
                {form.category === 'Get On The Flora' && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.localPickup}
                      onChange={(e) => setForm({ ...form, localPickup: e.target.checked })}
                      className="w-5 h-5 accent-ink"
                    />
                    <span className="font-mono text-[13px]">
                      Local Pickup Only
                      <span className="block font-mono text-[11px] text-warm-gray">No shipping — buyer must collect in person</span>
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Local Drop-off — artist physically delivered item to the store */}
            <div className="border border-warm-gray-light p-4" style={{ background: form.localDropoff ? 'rgba(185,122,48,0.05)' : 'transparent' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.localDropoff}
                  onChange={(e) => setForm({ ...form, localDropoff: e.target.checked })}
                  className="w-5 h-5 accent-ink mt-0.5"
                />
                <span>
                  <span className="font-mono text-[13px] text-ink block">Local Drop-off Item</span>
                  <span className="font-mono text-[11px] text-warm-gray block mt-0.5">
                    Artist delivered this item to the store. Commission: 5% (vs standard 10%).
                    Collector can pick up in-store or Art Saturated can ship it.
                  </span>
                </span>
              </label>
            </div>

            {publishError && (
              <p className="font-mono text-[12px] text-red-500 mt-2">{publishError}</p>
            )}

            <div className="flex flex-col gap-3 mt-2">
              {/* Publish (always shown) */}
              <button
                type="submit"
                onClick={() => setSubmitMode('publish')}
                className="btn-outline w-full text-center py-4"
                disabled={publishBusy || imgUploading}
              >
                {imgUploading ? 'Uploading image…'
                  : publishBusy && submitMode === 'publish' ? 'Saving…'
                  : view === 'add' ? 'Publish'
                  : 'Save Changes'}
              </button>

              {/* Add to Drop Bucket (new listings only) */}
              {view === 'add' && (
                <button
                  type="submit"
                  onClick={() => setSubmitMode('bucket')}
                  className="w-full font-mono text-[12px] uppercase tracking-widest py-4 border text-warm-gray"
                  style={{ borderColor: '#b97a30', color: '#b97a30' }}
                  disabled={publishBusy || imgUploading}
                >
                  {publishBusy && submitMode === 'bucket' ? 'Saving…' : '+ Add to Drop Bucket'}
                </button>
              )}

              {/* Save to Private Collection (new listings only) — never public */}
              {view === 'add' && (
                <button
                  type="submit"
                  onClick={() => setSubmitMode('collection')}
                  className="w-full font-mono text-[12px] uppercase tracking-widest py-4 border"
                  style={{ borderColor: '#6a6aaf', color: '#6a6aaf' }}
                  disabled={publishBusy || imgUploading}
                  title="Private — saved only to your personal collection, never shown publicly"
                >
                  {publishBusy && submitMode === 'collection' ? 'Saving…' : '⌂ Save to Private Collection'}
                </button>
              )}

              {/* Save Draft (new listings only) */}
              {view === 'add' && (
                <button
                  type="button"
                  onPointerUp={() => { saveDraft(form); setDraftSaved('saved'); setTimeout(() => setDraftSaved(''), 2000) }}
                  className="w-full font-mono text-[12px] uppercase tracking-widest py-4 border border-warm-gray-light text-warm-gray"
                  disabled={publishBusy}
                >
                  {draftSaved === 'saved' ? '✓ Draft Saved' : 'Save Draft'}
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
    )
  }

  // ── Product list ───────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-cream px-4 pt-6 pb-20">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-serif text-[1.4rem]">Admin</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/account')}
              className="font-mono text-[11px] text-warm-gray uppercase tracking-widest"
            >
              ← Profile
            </button>
            <button
              onClick={() => navigate('/')}
              className="font-mono text-[11px] text-warm-gray uppercase tracking-widest"
            >
              ← Site
            </button>
          </div>
        </div>

        {/* Tabs */}
        {(() => {
          // Daily-driver tabs up front; lower-frequency ones tuck behind "More".
          const PRIMARY = [
            ['products',    'Products'],
            ['orders',      'Orders'],
            ['review',      'Review'],
            ['submissions', 'Submissions'],
            ['ai',          'AI Usage'],
            ['bookings',    'Bookings'],
          ]
          const MORE = [
            ['feedback',    'Feedback'],
            ['cd-orders',   'CD Orders'],
            ['config',      'Store Config'],
            ['preorders',   'Preorders'],
            ['users',       'Users'],
            ['workshop',    'Workshop'],
          ]
          const moreActive = MORE.some(([k]) => k === tab)
          const tabBtn = (key, label) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`py-2 px-4 font-mono text-[10px] uppercase tracking-widest border transition-colors ${
                tab === key ? 'bg-ink text-cream border-ink' : 'border-warm-gray-light text-warm-gray hover:border-ink hover:text-ink'
              }`}
            >
              {label}
            </button>
          )
          return (
            <div className="flex flex-wrap gap-2 mb-8">
              {PRIMARY.map(([k, l]) => tabBtn(k, l))}
              <button
                onClick={() => setShowMoreTabs(v => !v)}
                className="py-2 px-4 font-mono text-[10px] uppercase tracking-widest border border-warm-gray-light text-warm-gray hover:border-ink hover:text-ink transition-colors"
              >
                {(showMoreTabs || moreActive) ? 'Less ▴' : 'More ▾'}
              </button>
              {(showMoreTabs || moreActive) && MORE.map(([k, l]) => tabBtn(k, l))}
            </div>
          )
        })()}

        {/* Bookings tab */}
        {tab === 'bookings' && <AvailabilityManager />}

        {/* Orders tab */}
        {tab === 'orders' && <OrdersPanel />}

        {/* Review tab — seller listings that published without approval */}
        {tab === 'review' && <ReviewDeck />}

        {/* Submissions tab */}
        {tab === 'submissions' && <SubmissionsPanel />}

        {/* Feedback tab */}
        {tab === 'feedback' && <FeedbackPanel />}

        {/* Events tab */}

        {/* Magazine tab */}

        {/* AI Usage tab */}
        {tab === 'ai' && <AiUsagePanel />}

        {/* Interviews tab */}

        {/* CD Orders tab */}
        {tab === 'cd-orders' && <CDOrdersPanel />}

        {/* Store Config tab */}
        {tab === 'config' && <StoreConfigPanel />}

        {/* Partnerships tab */}

        {/* Preorders tab — album + product preorders merged */}
        {tab === 'preorders' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '36px' }}>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-warm-gray mb-4">Album Preorders</p>
              <AlbumPreordersPanel />
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-warm-gray mb-4">Product Preorders</p>
              <PreordersPanel />
            </div>
          </div>
        )}

        {/* Users tab */}
        {tab === 'users' && <UsersPanel />}

        {/* Workshop RSVPs tab */}
        {tab === 'workshop' && <WorkshopPanel />}

        {/* Products tab */}
        {tab === 'products' && (() => {
          const activeProducts   = products.filter(p => !p.inBucket &&  p.active)
          const inactiveProducts = products.filter(p => !p.inBucket && !p.active)
          const bucketProducts   = products.filter(p =>  !!p.inBucket)
          const visibleList = productSubTab === 'active' ? activeProducts
                            : productSubTab === 'inactive' ? inactiveProducts
                            : bucketProducts

          return (
            <>
              <button onClick={openAdd} className="btn-outline w-full text-center mb-4">
                + Add Product
              </button>

              {/* Sub-tabs: Active / Inactive / Drop Bucket / Collection */}
              <div className="flex flex-wrap gap-2 mb-5">
                {[
                  ['active',     `Active (${activeProducts.length})`],
                  ['inactive',   `Inactive (${inactiveProducts.length})`],
                  ['bucket',     `Drop Bucket (${bucketProducts.length})`],
                  ['collection', `Collection (${archiveItems.length})`],
                ].map(([key, label]) => {
                  const activeColor = key === 'bucket' ? '#b97a30' : key === 'collection' ? '#6a6aaf' : '#1a1208'
                  return (
                  <button
                    key={key}
                    onClick={() => setProductSubTab(key)}
                    className="py-1.5 px-3 font-mono text-[10px] uppercase tracking-widest border transition-colors"
                    style={{
                      background:   productSubTab === key ? activeColor : 'transparent',
                      color:        productSubTab === key ? '#f5f0e8' : '#9a9088',
                      borderColor:  productSubTab === key ? activeColor : '#c8bfb0',
                    }}
                  >
                    {label}
                  </button>
                  )
                })}
              </div>

              {/* Bucket: Publish All banner */}
              {productSubTab === 'bucket' && bucketProducts.length > 0 && (
                <div className="flex items-center justify-between border px-4 py-3 mb-4"
                  style={{ borderColor: '#b97a30', background: 'rgba(185,122,48,0.06)' }}>
                  <p className="font-mono text-[11px] uppercase tracking-widest" style={{ color: '#b97a30' }}>
                    {bucketProducts.length} listing{bucketProducts.length !== 1 ? 's' : ''} ready to drop
                  </p>
                  <button
                    onClick={handlePublishAllBucket}
                    disabled={bucketBusy}
                    className="font-mono text-[11px] uppercase tracking-widest px-4 py-2"
                    style={{ background: '#b97a30', color: '#fff', opacity: bucketBusy ? 0.6 : 1 }}
                  >
                    {bucketBusy ? 'Publishing…' : 'Publish All'}
                  </button>
                </div>
              )}

              {/* Collection: private archive — admin-only, never public */}
              {productSubTab === 'collection' ? (
                <div>
                  <p className="font-mono text-[11px] mb-4" style={{ color: '#6a6aaf' }}>
                    ⌂ Private — these items are never shown in the shop or anywhere public. Use “Convert to listing” to publish one.
                  </p>
                  {archiveItems.length === 0 ? (
                    <p className="font-mono text-[13px] text-warm-gray text-center py-12">
                      Your private collection is empty. Add an item via “+ Add Product” → “Save to Private Collection.”
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {archiveItems.map((item) => {
                        const img = Array.isArray(item.imageURLs) ? item.imageURLs[0] : (item.imageURL || item.image || null)
                        async function convertToListing() {
                          if (!window.confirm(`Publish “${item.name || 'this item'}” as a live listing?`)) return
                          try {
                            await addProduct({ ...item, id: undefined, active: true, inBucket: false, source: 'collection-convert' })
                            await deleteArchiveItem(item.id)
                            setArchiveItems(prev => prev.filter(x => x.id !== item.id))
                            fetchAllProducts().then(setProducts).catch(() => {})
                            setProductSubTab('active')
                          } catch (err) { alert('Convert failed: ' + err.message) }
                        }
                        async function removeItem() {
                          if (!window.confirm(`Delete “${item.name || 'this item'}” from your collection? This can’t be undone.`)) return
                          try {
                            await deleteArchiveItem(item.id)
                            setArchiveItems(prev => prev.filter(x => x.id !== item.id))
                          } catch (err) { alert('Delete failed: ' + err.message) }
                        }
                        return (
                          <div key={item.id} className="flex gap-3 items-center border p-3" style={{ borderColor: '#d8d2e4', background: 'rgba(106,106,175,0.04)' }}>
                            <div style={{ width: '52px', height: '52px', flexShrink: 0, background: '#ece8f0', overflow: 'hidden', borderRadius: '2px' }}>
                              {img && <img src={img} alt={item.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p className="font-serif text-[15px] text-ink truncate" style={{ margin: 0 }}>{item.name || '(untitled)'}</p>
                              <p className="font-mono text-[11px]" style={{ color: '#7a5030', margin: '2px 0 0' }}>
                                {item.category || 'Uncategorized'}{item.price ? ` · $${item.price}` : ''}
                              </p>
                            </div>
                            <button onClick={convertToListing}
                              className="font-mono text-[10px] uppercase tracking-widest px-3 py-2 border shrink-0"
                              style={{ borderColor: '#3a7a40', color: '#3a7a40' }}>
                              Convert to listing
                            </button>
                            <button onClick={removeItem}
                              className="font-mono text-[10px] uppercase tracking-widest px-2 py-2 border shrink-0"
                              style={{ borderColor: '#c8bfb0', color: '#b94040' }}>
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : productsLoading ? (
                <p className="font-mono text-[13px] text-warm-gray text-center py-12 animate-pulse">Loading…</p>
              ) : visibleList.length === 0 ? (
                <p className="font-mono text-[13px] text-warm-gray text-center py-12">
                  {productSubTab === 'active'   && 'No active listings.'}
                  {productSubTab === 'inactive' && 'No archived listings.'}
                  {productSubTab === 'bucket'   && 'Drop bucket is empty.'}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {visibleList.map((p) => (
                    <div
                      key={p.id}
                      className="border border-warm-gray-light p-3"
                      style={{ opacity: p.sold ? 0.7 : 1 }}
                    >
                      {/* Thumbnail + info row */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-14 h-14 bg-paper flex items-center justify-center shrink-0 overflow-hidden relative">
                          {(p.imageURL || p.image) ? (
                            <img src={p.imageURL || p.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-2xl">{p.emoji || '🖼️'}</span>
                          )}
                          {p.sold && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,18,8,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span className="font-mono text-[8px] text-cream tracking-widest uppercase">Sold</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="font-mono text-[13px] text-ink truncate">{p.name}</p>
                            {p.sold && <span className="font-mono text-[9px] uppercase tracking-widest text-warm-gray border border-warm-gray-light px-1.5 py-0.5 shrink-0">Sold</span>}
                          </div>
                          <p className="font-mono text-[11px] text-warm-gray">
                            ${p.price}
                            {p.itemNumber && <span className="ml-2 opacity-60">{formatItemNumber(p.itemNumber)}</span>}
                          </p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 flex-wrap items-center">
                        <button
                          onClick={() => openEdit(p)}
                          className="font-mono text-[10px] text-ink uppercase tracking-widest border border-warm-gray-light px-3 py-1.5"
                        >
                          Edit
                        </button>

                        {productSubTab === 'active' && (<>
                          <button
                            onClick={() => handleToggleSold(p)}
                            className="font-mono text-[10px] uppercase tracking-widest border px-3 py-1.5"
                            style={{ color: p.sold ? '#3a7a40' : '#b97a30', borderColor: p.sold ? '#3a7a40' : '#b97a30' }}
                          >
                            {p.sold ? 'Unsell' : 'Mark Sold'}
                          </button>
                          <button
                            onClick={() => handleAddToBucket(p)}
                            className="font-mono text-[10px] uppercase tracking-widest border px-3 py-1.5"
                            style={{ color: '#b97a30', borderColor: '#b97a30' }}
                          >
                            → Bucket
                          </button>
                          <button
                            onClick={() => handleArchive(p)}
                            className="font-mono text-[10px] text-warm-gray uppercase tracking-widest border border-warm-gray-light px-3 py-1.5"
                          >
                            Archive
                          </button>
                        </>)}

                        {productSubTab === 'inactive' && (<>
                          <button
                            onClick={() => handleRestore(p)}
                            className="font-mono text-[10px] uppercase tracking-widest border px-3 py-1.5"
                            style={{ color: '#3a7a40', borderColor: '#3a7a40' }}
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handleAddToBucket(p)}
                            className="font-mono text-[10px] uppercase tracking-widest border px-3 py-1.5"
                            style={{ color: '#b97a30', borderColor: '#b97a30' }}
                          >
                            → Bucket
                          </button>
                        </>)}

                        {productSubTab === 'bucket' && (<>
                          <button
                            onClick={() => handlePublishSingle(p)}
                            className="font-mono text-[10px] uppercase tracking-widest border px-3 py-1.5"
                            style={{ color: '#3a7a40', borderColor: '#3a7a40' }}
                          >
                            Publish
                          </button>
                          <button
                            onClick={() => handleRemoveFromBucket(p)}
                            className="font-mono text-[10px] text-warm-gray uppercase tracking-widest border border-warm-gray-light px-3 py-1.5"
                          >
                            Remove
                          </button>
                        </>)}

                        <button
                          onClick={() => handleDelete(p)}
                          className="font-mono text-[10px] text-red-400 uppercase tracking-widest border border-red-200 px-3 py-1.5 ml-auto"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        })()}
      </div>
    </main>
  )
}
