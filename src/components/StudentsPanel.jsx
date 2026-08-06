import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import { getStudents, addStudent, updateStudent, removeStudent } from '../data/booking'
import LessonNotebook from './LessonNotebook'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const PLAN_OPTIONS = [
  { value: 'single',     label: 'Single Lesson' },
  { value: 'monthly_1x', label: 'Monthly 1×/week' },
  { value: 'monthly_2x', label: 'Monthly 2×/week' },
]

const DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '60 min' },
  { value: 90,  label: '90 min' },
]

const EQUIPMENT_OPTIONS = [
  'Laptop', 'Desktop', 'iPad / Tablet', 'MIDI Controller',
  'Drum Machine', 'Piano / Keyboard', 'Synthesizer',
  'Audio Interface', 'Headphones', 'Studio Monitors',
  'Microphone', 'Guitar', 'Bass', 'DAW Software',
]

const BILLING_CYCLES = [
  { value: 'monthly',   label: 'Monthly' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'per_lesson', label: 'Per Lesson' },
]

const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Cash' },
  { value: 'venmo',  label: 'Venmo' },
  { value: 'zelle',  label: 'Zelle' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'other',  label: 'Other' },
]

// Generate time options every 30 min from 08:00 to 22:00
function buildTimeOptions() {
  const opts = []
  for (let h = 8; h <= 22; h++) {
    for (const mn of [0, 30]) {
      if (h === 22 && mn === 30) break
      const ampm  = h >= 12 ? 'PM' : 'AM'
      const hr    = h % 12 || 12
      const label = `${hr}:${mn === 0 ? '00' : '30'} ${ampm}`
      const value = `${String(h).padStart(2, '0')}:${mn === 0 ? '00' : '30'}`
      opts.push({ value, label })
    }
  }
  return opts
}
const TIME_OPTIONS = buildTimeOptions()

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    border: '1px solid #d4c9bb',
    background: '#faf8f4',
    padding: '14px 16px',
    marginBottom: '10px',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#3d2810',
    display: 'block',
    marginBottom: '5px',
  },
  input: {
    width: '100%',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '9px 12px',
    border: '1px solid #d4c9bb',
    background: '#fff',
    color: '#1a1208',
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: '10px',
  },
  select: {
    width: '100%',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '9px 12px',
    border: '1px solid #d4c9bb',
    background: '#fff',
    color: '#1a1208',
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: '10px',
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '9px 12px',
    border: '1px solid #d4c9bb',
    background: '#fff',
    color: '#1a1208',
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: '10px',
    resize: 'vertical',
    minHeight: '70px',
  },
  btn: (active) => ({
    fontFamily: 'monospace',
    fontSize: '10px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '7px 14px',
    border: '1px solid',
    cursor: 'pointer',
    background: active ? '#1a1208' : 'transparent',
    borderColor: active ? '#1a1208' : '#d4c9bb',
    color: active ? '#f2ebe0' : '#3d2810',
    transition: 'all 0.15s',
  }),
  btnDanger: {
    fontFamily: 'monospace',
    fontSize: '10px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '7px 14px',
    border: '1px solid #b94040',
    cursor: 'pointer',
    background: 'transparent',
    color: '#b94040',
    transition: 'all 0.15s',
  },
  row: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '4px',
  },
  badge: (active) => ({
    fontFamily: 'monospace',
    fontSize: '9px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    border: `1px solid ${active ? '#3a7a40' : '#b94040'}`,
    color: active ? '#3a7a40' : '#b94040',
  }),
  formSection: {
    border: '1px solid #d4c9bb',
    background: '#f5f0e8',
    padding: '16px',
    marginBottom: '16px',
  },
  field: {
    marginBottom: '4px',
  },
}

// ── Blank form state ──────────────────────────────────────────────────────────

const BLANK = {
  name: '',
  email: '',
  phone: '',
  instrument: '',
  plan: 'single',
  price: '',
  notes: '',
  hasSchedule: false,
  schedDow: 1,
  schedStart: '09:00',
  schedDuration: 60,
  active: true,
  // Tuition
  billingCycle: 'monthly',
  paymentMethod: 'cash',
  paymentHandle: '',
  duesPaid: false,
  nextDueDate: '',
  classesAttended: 0,
  subjects:  [],   // array of strings e.g. ['Piano', 'Beat Making']
  equipment: [],   // array of strings from EQUIPMENT_OPTIONS or custom
}

function studentToForm(student) {
  const sched = student.schedule || {}
  return {
    name:           student.name         || '',
    email:          student.email        || '',
    phone:          student.phone        || '',
    instrument:     student.instrument   || '',
    plan:           student.plan         || 'single',
    price:          student.price != null ? String(student.price) : '',
    notes:          student.notes        || '',
    hasSchedule:    !!student.schedule,
    schedDow:       sched.dayOfWeek      ?? 1,
    schedStart:     sched.startTime      || '09:00',
    schedDuration:  sched.duration       ?? 60,
    active:         student.active       ?? true,
    billingCycle:   student.billingCycle  || 'monthly',
    paymentMethod:  student.paymentMethod || 'cash',
    paymentHandle:  student.paymentHandle || '',
    duesPaid:       student.duesPaid      ?? false,
    nextDueDate:    student.nextDueDate   || '',
    classesAttended: student.classesAttended ?? 0,
    subjects:  student.subjects  || [],
    equipment: student.equipment || [],
  }
}

function formToData(form) {
  const data = {
    name:           form.name.trim(),
    email:          form.email.trim(),
    phone:          form.phone.trim(),
    instrument:     form.instrument.trim(),
    plan:           form.plan,
    price:          form.price !== '' ? Number(form.price) : null,
    notes:          form.notes.trim(),
    active:         form.active,
    schedule:       null,
    billingCycle:   form.billingCycle,
    paymentMethod:  form.paymentMethod,
    paymentHandle:  form.paymentHandle.trim(),
    duesPaid:       form.duesPaid,
    nextDueDate:    form.nextDueDate,
    classesAttended: Number(form.classesAttended) || 0,
    subjects:  form.subjects,
    equipment: form.equipment,
  }
  if (form.hasSchedule) {
    data.schedule = {
      dayOfWeek: Number(form.schedDow),
      startTime: form.schedStart,
      duration:  Number(form.schedDuration),
    }
  }
  return data
}

function fmtSchedule(student) {
  if (!student.schedule) return null
  const { dayOfWeek, startTime, duration } = student.schedule
  const day  = DAY_NAMES[dayOfWeek] || ''
  const [h, mn] = startTime.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr   = h % 12 || 12
  const time = `${hr}:${mn === 0 ? '00' : '30'} ${ampm}`
  return `${day} ${time} · ${duration} min`
}

function planLabel(plan) {
  return PLAN_OPTIONS.find(p => p.value === plan)?.label || plan
}

function isOverdue(dateStr) {
  if (!dateStr) return false
  return new Date(dateStr + 'T00:00:00') < new Date()
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StudentsPanel() {
  const [students,       setStudents]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [formMode,       setFormMode]       = useState(null)   // null | 'add' | studentId
  const [form,           setForm]           = useState(BLANK)
  const [busy,           setBusy]           = useState(false)
  const [error,          setError]          = useState('')
  const [expandedNotes,  setExpandedNotes]  = useState(new Set())
  const [inviting,       setInviting]       = useState(new Set())   // student IDs currently sending
  const [inviteSent,     setInviteSent]     = useState(new Set())   // student IDs with recent success

  async function load() {
    setLoading(true)
    try {
      setStudents(await getStudents())
    } catch (e) {
      console.error('StudentsPanel load:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setForm(BLANK)
    setFormMode('add')
    setError('')
  }

  function openEdit(student) {
    setForm(studentToForm(student))
    setFormMode(student.id)
    setError('')
  }

  function closeForm() {
    setFormMode(null)
    setError('')
  }

  function field(key) {
    return {
      value: form[key],
      onChange: e => setForm(f => ({ ...f, [key]: e.target.value })),
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setBusy(true); setError('')
    try {
      const data = formToData(form)
      if (formMode === 'add') {
        await addStudent(data)
      } else {
        await updateStudent(formMode, data)
      }
      await load()
      closeForm()
    } catch (err) {
      console.error('StudentsPanel save:', err)
      setError('Save failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(student) {
    if (!window.confirm(`Remove student "${student.name}"? This cannot be undone.`)) return
    try {
      await removeStudent(student.id)
      await load()
      if (formMode === student.id) closeForm()
    } catch (err) {
      console.error('StudentsPanel delete:', err)
    }
  }

  async function handleMarkPaid(student) {
    try {
      await updateStudent(student.id, { duesPaid: true })
      setStudents(prev => prev.map(s => s.id === student.id ? { ...s, duesPaid: true } : s))
    } catch (err) { console.error('handleMarkPaid:', err) }
  }

  async function handleIncrementClasses(student) {
    const newCount = (student.classesAttended || 0) + 1
    try {
      await updateStudent(student.id, { classesAttended: newCount })
      setStudents(prev => prev.map(s => s.id === student.id ? { ...s, classesAttended: newCount } : s))
    } catch (err) { console.error('handleIncrementClasses:', err) }
  }

  async function handleInvite(student) {
    if (!student.email || inviting.has(student.id)) return
    setInviting(prev => new Set(prev).add(student.id))
    try {
      const invite = httpsCallable(functions, 'sendStudentInvite')
      await invite({ studentEmail: student.email, studentName: student.name })
      // Refresh to get the invitedAt timestamp written by the function
      const updated = await getStudents()
      setStudents(updated)
      setInviteSent(prev => {
        const next = new Set(prev)
        next.add(student.id)
        setTimeout(() => setInviteSent(s => { const n = new Set(s); n.delete(student.id); return n }), 3000)
        return next
      })
    } catch (err) {
      console.error('handleInvite:', err)
      alert('Failed to send invite. Please try again.')
    } finally {
      setInviting(prev => { const next = new Set(prev); next.delete(student.id); return next })
    }
  }

  // ── Form ───────────────────────────────────────────────────────────

  function renderForm() {
    return (
      <div style={s.formSection}>
        <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#3d2810', marginBottom: '14px' }}>
          {formMode === 'add' ? 'Add Student' : 'Edit Student'}
        </p>
        <form onSubmit={handleSave}>

          {/* Name */}
          <div style={s.field}>
            <label style={s.label}>Name *</label>
            <input style={s.input} type="text" placeholder="Full name" required {...field('name')} />
          </div>

          {/* Email */}
          <div style={s.field}>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" placeholder="student@email.com" {...field('email')} />
          </div>

          {/* Phone */}
          <div style={s.field}>
            <label style={s.label}>Phone</label>
            <input style={s.input} type="tel" placeholder="(555) 000-0000" {...field('phone')} />
          </div>

          {/* Instrument */}
          <div style={s.field}>
            <label style={s.label}>Instrument</label>
            <input style={s.input} type="text" placeholder="e.g. Piano" {...field('instrument')} />
          </div>

          {/* Plan */}
          <div style={s.field}>
            <label style={s.label}>Plan</label>
            <select style={s.select} value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
              {PLAN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Price */}
          <div style={s.field}>
            <label style={s.label}>Price ($)</label>
            <input style={s.input} type="number" min="0" step="0.01" placeholder="0.00" {...field('price')} />
          </div>

          {/* Notes */}
          <div style={s.field}>
            <label style={s.label}>Notes</label>
            <textarea style={s.textarea} placeholder="Any notes about this student..." {...field('notes')} />
          </div>

          {/* ── Subjects ── */}
          <div style={s.field}>
            <label style={s.label}>Lesson Subjects</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {(form.subjects || []).map(sub => (
                <span key={sub} style={{ fontFamily: 'monospace', fontSize: '11px', padding: '3px 8px', border: '1px solid #d4c9bb', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  {sub}
                  <button type="button" onClick={() => setForm(f => ({ ...f, subjects: f.subjects.filter(s => s !== sub) }))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b94040', fontSize: '12px', lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="e.g. Piano, Beat Making"
                id="subjectInput"
                style={{ ...s.input, flex: 1, marginBottom: 0 }}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
                    e.preventDefault()
                    const val = e.target.value.trim().replace(/,$/, '')
                    if (val && !(form.subjects || []).includes(val)) {
                      setForm(f => ({ ...f, subjects: [...(f.subjects || []), val] }))
                    }
                    e.target.value = ''
                  }
                }}
              />
              <button type="button"
                style={{ ...s.btn(false), whiteSpace: 'nowrap' }}
                onClick={() => {
                  const input = document.getElementById('subjectInput')
                  const val = input?.value?.trim()
                  if (val && !(form.subjects || []).includes(val)) {
                    setForm(f => ({ ...f, subjects: [...(f.subjects || []), val] }))
                    if (input) input.value = ''
                  }
                }}>Add</button>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a7060', marginTop: '4px' }}>
              Press Enter or comma to add
            </p>
          </div>

          {/* ── Equipment ── */}
          <div style={s.field}>
            <label style={s.label}>Student's Equipment</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
              {EQUIPMENT_OPTIONS.map(eq => {
                const checked = (form.equipment || []).includes(eq)
                return (
                  <label key={eq} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: '#1a1208' }}>
                    <input type="checkbox" checked={checked}
                      onChange={e => setForm(f => ({
                        ...f,
                        equipment: e.target.checked
                          ? [...(f.equipment || []), eq]
                          : (f.equipment || []).filter(x => x !== eq)
                      }))} />
                    {eq}
                  </label>
                )
              })}
            </div>
            {/* Custom equipment not in preset list */}
            {(form.equipment || []).filter(e => !EQUIPMENT_OPTIONS.includes(e)).map(eq => (
              <span key={eq} style={{ fontFamily: 'monospace', fontSize: '11px', padding: '3px 8px', border: '1px solid #d4c9bb', display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '6px', marginBottom: '6px' }}>
                {eq}
                <button type="button" onClick={() => setForm(f => ({ ...f, equipment: (f.equipment || []).filter(x => x !== eq) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b94040', fontSize: '12px', padding: 0 }}>×</button>
              </span>
            ))}
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <input type="text" placeholder="Add custom equipment…" id="equipInput"
                style={{ ...s.input, flex: 1, marginBottom: 0 }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    e.preventDefault()
                    const val = e.target.value.trim()
                    if (!(form.equipment || []).includes(val)) {
                      setForm(f => ({ ...f, equipment: [...(f.equipment || []), val] }))
                    }
                    e.target.value = ''
                  }
                }} />
              <button type="button" style={{ ...s.btn(false), whiteSpace: 'nowrap' }}
                onClick={() => {
                  const input = document.getElementById('equipInput')
                  const val = input?.value?.trim()
                  if (val && !(form.equipment || []).includes(val)) {
                    setForm(f => ({ ...f, equipment: [...(f.equipment || []), val] }))
                    if (input) input.value = ''
                  }
                }}>Add</button>
            </div>
          </div>

          {/* ── Tuition ── */}
          <div style={{ border: '1px solid #d4c9bb', padding: '12px', background: '#fff', marginBottom: '12px' }}>
            <p style={{ ...s.label, color: '#8a7060', marginBottom: '10px' }}>Tuition</p>

            <label style={s.label}>Billing Cycle</label>
            <select style={s.select} value={form.billingCycle} onChange={e => setForm(f => ({ ...f, billingCycle: e.target.value }))}>
              {BILLING_CYCLES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label style={s.label}>Payment Method</label>
            <select style={s.select} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
              {PAYMENT_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {form.paymentMethod !== 'cash' && (
              <div style={s.field}>
                <label style={s.label}>{
                  form.paymentMethod === 'venmo'  ? 'Venmo Handle' :
                  form.paymentMethod === 'zelle'  ? 'Zelle Email / Phone' :
                  form.paymentMethod === 'paypal' ? 'PayPal Email' : 'Payment Detail'
                }</label>
                <input style={s.input} type="text" placeholder="@handle or email"
                  value={form.paymentHandle} onChange={e => setForm(f => ({ ...f, paymentHandle: e.target.value }))} />
              </div>
            )}

            <label style={s.label}>Next Due Date</label>
            <input style={s.input} type="date" value={form.nextDueDate}
              onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <input type="checkbox" id="duesPaid" checked={form.duesPaid}
                onChange={e => setForm(f => ({ ...f, duesPaid: e.target.checked }))}
                style={{ cursor: 'pointer' }} />
              <label htmlFor="duesPaid" style={{ ...s.label, marginBottom: 0, cursor: 'pointer' }}>
                Dues paid for current cycle
              </label>
            </div>

            <label style={s.label}>Classes Attended</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <button type="button"
                onClick={() => setForm(f => ({ ...f, classesAttended: Math.max(0, (Number(f.classesAttended) || 0) - 1) }))}
                style={{ ...s.btn(false), padding: '4px 12px', fontSize: '14px' }}>−</button>
              <input style={{ ...s.input, width: '64px', textAlign: 'center', marginBottom: 0 }}
                type="number" min="0"
                value={form.classesAttended}
                onChange={e => setForm(f => ({ ...f, classesAttended: e.target.value }))} />
              <button type="button"
                onClick={() => setForm(f => ({ ...f, classesAttended: (Number(f.classesAttended) || 0) + 1 }))}
                style={{ ...s.btn(false), padding: '4px 12px', fontSize: '14px' }}>+</button>
            </div>
          </div>

          {/* Has recurring schedule */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <input
              type="checkbox"
              id="hasSchedule"
              checked={form.hasSchedule}
              onChange={e => setForm(f => ({ ...f, hasSchedule: e.target.checked }))}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="hasSchedule" style={{ ...s.label, marginBottom: 0, cursor: 'pointer' }}>
              Has recurring schedule
            </label>
          </div>

          {/* Schedule fields */}
          {form.hasSchedule && (
            <div style={{ border: '1px solid #d4c9bb', padding: '12px', background: '#fff', marginBottom: '10px' }}>
              <p style={{ ...s.label, marginBottom: '10px' }}>Schedule</p>

              <label style={s.label}>Day of Week</label>
              <select
                style={s.select}
                value={form.schedDow}
                onChange={e => setForm(f => ({ ...f, schedDow: Number(e.target.value) }))}
              >
                {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>

              <label style={s.label}>Start Time</label>
              <select
                style={s.select}
                value={form.schedStart}
                onChange={e => setForm(f => ({ ...f, schedStart: e.target.value }))}
              >
                {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              <label style={s.label}>Duration</label>
              <select
                style={s.select}
                value={form.schedDuration}
                onChange={e => setForm(f => ({ ...f, schedDuration: Number(e.target.value) }))}
              >
                {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* Active */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <input
              type="checkbox"
              id="studentActive"
              checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="studentActive" style={{ ...s.label, marginBottom: 0, cursor: 'pointer' }}>
              Active student
            </label>
          </div>

          {error && (
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', marginBottom: '10px' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy} style={s.btn(true)}>
              {busy ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={closeForm} style={s.btn(false)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#3d2810', margin: 0 }}>
          Students ({students.length})
        </p>
        {formMode !== 'add' && (
          <button onClick={openAdd} style={s.btn(true)}>
            + Add Student
          </button>
        )}
      </div>

      {/* Add form */}
      {formMode === 'add' && renderForm()}

      {/* Loading */}
      {loading && (
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a7060' }}>Loading...</p>
      )}

      {/* Empty state */}
      {!loading && students.length === 0 && formMode !== 'add' && (
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a7060', textAlign: 'center', padding: '24px 0' }}>
          No students yet. Add one to get started.
        </p>
      )}

      {/* Student cards */}
      {students.map(student => (
        <div key={student.id}>
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1208', margin: '0 0 3px', fontWeight: 500 }}>
                  {student.name}
                </p>
                {student.instrument && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3d2810', margin: '0 0 2px' }}>
                    {student.instrument}
                  </p>
                )}
                {student.plan && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7060', margin: '0 0 2px' }}>
                    {planLabel(student.plan)}{student.price != null ? ` · $${student.price}` : ''}
                  </p>
                )}
                {student.schedule && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3d2810', margin: '0 0 2px' }}>
                    {fmtSchedule(student)}
                  </p>
                )}
              </div>
              <span style={s.badge(student.active !== false)}>
                {student.active !== false ? 'Active' : 'Inactive'}
              </span>
            </div>

            {student.email && (
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7060', margin: '0 0 2px' }}>
                {student.email}{student.phone ? ` · ${student.phone}` : ''}
              </p>
            )}

            {/* Tuition status */}
            {(student.nextDueDate || student.duesPaid != null) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px', flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase',
                  padding: '2px 7px', border: '1px solid',
                  color:       student.duesPaid ? '#3a7a40' : isOverdue(student.nextDueDate) ? '#b94040' : '#b97a30',
                  borderColor: student.duesPaid ? '#3a7a40' : isOverdue(student.nextDueDate) ? '#b94040' : '#b97a30',
                }}>
                  {student.duesPaid ? 'Paid ✓' : isOverdue(student.nextDueDate) ? 'Overdue' : 'Due'}
                </span>
                {student.nextDueDate && (
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7060' }}>
                    {fmtDate(student.nextDueDate)}
                  </span>
                )}
                {student.paymentMethod && student.paymentMethod !== 'cash' && (
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7060' }}>
                    · {student.paymentMethod}{student.paymentHandle ? ` ${student.paymentHandle}` : ''}
                  </span>
                )}
                {(student.classesAttended ?? 0) > 0 && (
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a7060' }}>
                    · {student.classesAttended} class{student.classesAttended !== 1 ? 'es' : ''}
                  </span>
                )}
              </div>
            )}

            {student.notes && (
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3d2810', margin: '4px 0 0', fontStyle: 'italic', opacity: 0.75 }}>
                {student.notes}
              </p>
            )}

            {/* Subjects */}
            {(student.subjects || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                {student.subjects.map(sub => (
                  <span key={sub} style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 7px', border: '1px solid #b97a30', color: '#b97a30' }}>
                    {sub}
                  </span>
                ))}
              </div>
            )}

            {/* Equipment */}
            {(student.equipment || []).length > 0 && (
              <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a7060', marginTop: '4px' }}>
                ⚙ {student.equipment.join(' · ')}
              </p>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={() => formMode === student.id ? closeForm() : openEdit(student)}
                style={s.btn(formMode === student.id)}
              >
                {formMode === student.id ? 'Close' : 'Edit'}
              </button>
              {!student.duesPaid && (
                <button onClick={() => handleMarkPaid(student)}
                  style={{ ...s.btn(false), borderColor: '#3a7a40', color: '#3a7a40' }}>
                  Mark Paid
                </button>
              )}
              <button onClick={() => handleIncrementClasses(student)} style={s.btn(false)}>
                +1 Class
              </button>
              <button onClick={() => handleDelete(student)} style={s.btnDanger}>
                Delete
              </button>
              {student.email && (
                <button
                  onClick={() => setExpandedNotes(prev => {
                    const next = new Set(prev)
                    if (next.has(student.id)) { next.delete(student.id) } else { next.add(student.id) }
                    return next
                  })}
                  style={s.btn(expandedNotes.has(student.id))}
                >
                  Notes
                </button>
              )}
              {student.email && (
                <button
                  onClick={() => handleInvite(student)}
                  disabled={inviting.has(student.id)}
                  style={{
                    ...s.btn(false),
                    borderColor: inviteSent.has(student.id) ? '#3a7a40' : '#3a5a8a',
                    color:       inviteSent.has(student.id) ? '#3a7a40' : '#3a5a8a',
                    opacity: inviting.has(student.id) ? 0.5 : 1,
                  }}
                >
                  {inviting.has(student.id) ? 'Sending…' : inviteSent.has(student.id) ? 'Sent ✓' : student.invitedAt ? 'Re-Invite' : 'Invite'}
                </button>
              )}
            </div>
            {student.invitedAt && (
              <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a7060', marginTop: '6px' }}>
                Invite sent {new Date(student.invitedAt.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>

          {/* Lesson Notebook */}
          {expandedNotes.has(student.id) && student.email && (
            <div style={{ border: '1px solid #d4c9bb', borderTop: 'none', background: '#f5f0e8', padding: '12px 16px' }}>
              <LessonNotebook studentEmail={student.email} isAdmin={true} subjects={student.subjects || []} />
            </div>
          )}

          {/* Inline edit form */}
          {formMode === student.id && renderForm()}
        </div>
      ))}
    </div>
  )
}
