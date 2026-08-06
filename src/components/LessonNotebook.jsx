import { useState, useEffect } from 'react'
import { getLessonNotes, addLessonNote, toggleNoteComplete, deleteLessonNote, updateLessonNote } from '../data/booking'

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink:    '#1a1208',
  cream:  '#f2ebe0',
  brown:  '#3d2810',
  border: '#d4c9bb',
  card:   '#faf8f4',
  muted:  '#8a7060',
}

const sectionHeader = {
  fontFamily: 'monospace',
  fontSize: '10px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: T.muted,
  margin: '0 0 8px',
}

const itemStyle = (completed) => ({
  fontFamily: 'monospace',
  fontSize: '12px',
  color: T.ink,
  background: T.card,
  border: `1px solid ${T.border}`,
  padding: '10px 12px',
  marginBottom: '6px',
  opacity: completed ? 0.5 : 1,
  textDecoration: completed ? 'line-through' : 'none',
})

const inputStyle = {
  width: '100%',
  fontFamily: 'monospace',
  fontSize: '12px',
  padding: '8px 10px',
  border: `1px solid ${T.border}`,
  background: '#fff',
  color: T.ink,
  outline: 'none',
  boxSizing: 'border-box',
  marginBottom: '6px',
}

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '60px',
  marginBottom: '6px',
}

const smallBtn = (active) => ({
  fontFamily: 'monospace',
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '5px 10px',
  border: '1px solid',
  cursor: 'pointer',
  background: active ? T.ink : 'transparent',
  borderColor: active ? T.ink : T.border,
  color: active ? T.cream : T.brown,
  transition: 'all 0.15s',
})

const dangerBtn = {
  fontFamily: 'monospace',
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '4px 8px',
  border: '1px solid #b94040',
  cursor: 'pointer',
  background: 'transparent',
  color: '#b94040',
  marginLeft: '6px',
}

const BLANK_ADMIN = { type: 'homework', title: '', content: '', date: '', googleDocUrl: '', googleDocTitle: '', subject: '' }
const BLANK_NOTE  = { title: '', content: '' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function LessonNotebook({ studentEmail, isAdmin, subjects = [] }) {
  const [notes,       setNotes]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showForm,    setShowForm]    = useState(null)   // null | 'homework' | 'recap' | 'note'
  const [adminForm,   setAdminForm]   = useState(BLANK_ADMIN)
  const [noteForm,    setNoteForm]    = useState(BLANK_NOTE)
  const [busy,        setBusy]        = useState(false)
  const [activeSubject, setActiveSubject] = useState('All')
  const [editingId,     setEditingId]     = useState(null)    // note id being edited
  const [editForm,      setEditForm]      = useState({})

  async function load() {
    if (!studentEmail) return
    setLoading(true)
    try {
      setNotes(await getLessonNotes(studentEmail))
    } catch (e) {
      console.error('LessonNotebook load:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [studentEmail])

  // ── Partitions
  const subjectFilter = n => activeSubject === 'All' || !n.subject || n.subject === activeSubject
  const homework = notes.filter(n => n.type === 'homework' && subjectFilter(n))
  const recaps   = notes.filter(n => n.type === 'recap'    && subjectFilter(n))
  const myNotes  = notes.filter(n => n.type === 'note'     && subjectFilter(n))

  // ── Handlers
  async function handleAddAdmin(e) {
    e.preventDefault()
    if (!adminForm.title.trim()) return
    setBusy(true)
    try {
      await addLessonNote({
        studentEmail,
        type:      adminForm.type,
        title:     adminForm.title,
        content:   adminForm.content,
        date:      adminForm.date,
        googleDocUrl: adminForm.googleDocUrl.trim(),
        googleDocTitle: adminForm.googleDocTitle.trim(),
        subject:   adminForm.subject,
        createdBy: 'admin',
      })
      setAdminForm(BLANK_ADMIN)
      setShowForm(null)
      if (adminForm.subject) setActiveSubject(adminForm.subject)
      await load()
    } catch (e) {
      console.error('addLessonNote admin:', e)
    } finally {
      setBusy(false)
    }
  }

  async function handleAddNote(e) {
    e.preventDefault()
    if (!noteForm.title.trim()) return
    setBusy(true)
    try {
      await addLessonNote({
        studentEmail,
        type:      'note',
        title:     noteForm.title,
        content:   noteForm.content,
        date:      '',
        createdBy: 'student',
      })
      setNoteForm(BLANK_NOTE)
      setShowForm(null)
      await load()
    } catch (e) {
      console.error('addLessonNote student:', e)
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(note) {
    try {
      await toggleNoteComplete(note.id, !note.completed)
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, completed: !note.completed } : n))
    } catch (e) {
      console.error('toggleNoteComplete:', e)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this note?')) return
    try {
      await deleteLessonNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
    } catch (e) {
      console.error('deleteLessonNote:', e)
    }
  }

  async function handleUpdate(e) {
    e.preventDefault()
    if (!editForm.title?.trim()) return
    setBusy(true)
    try {
      await updateLessonNote(editingId, {
        title:   editForm.title,
        content: editForm.content || '',
        date:    editForm.date    || '',
        subject: editForm.subject || '',
        googleDocUrl:   editForm.googleDocUrl   || '',
        googleDocTitle: editForm.googleDocTitle || '',
      })
      setNotes(prev => prev.map(n => n.id === editingId ? { ...n, ...editForm } : n))
      setEditingId(null)
      setEditForm({})
    } catch (e) {
      console.error('updateLessonNote:', e)
    } finally {
      setBusy(false)
    }
  }

  // ── Render helpers
  function renderEditForm(note) {
    return (
      <form key={`edit-${note.id}`} onSubmit={handleUpdate}
        style={{ border: `1px solid ${T.border}`, background: '#f5f0e8', padding: '12px', marginBottom: '8px' }}>
        {subjects.length > 0 && (
          <select value={editForm.subject || ''} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))}
            style={{ ...inputStyle, marginBottom: '6px' }}>
            <option value="">All subjects</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <input style={inputStyle} type="text" placeholder="Title *" required
          value={editForm.title || ''} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
        <textarea style={textareaStyle} placeholder="Content"
          value={editForm.content || ''} onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))} />
        <input style={{ ...inputStyle, marginBottom: '6px' }} type="date"
          value={editForm.date || ''} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
        {note.type === 'homework' && (
          <>
            <input style={{ ...inputStyle, marginBottom: '4px' }} type="url" placeholder="Google Doc URL (optional)"
              value={editForm.googleDocUrl || ''} onChange={e => setEditForm(f => ({ ...f, googleDocUrl: e.target.value }))} />
            {editForm.googleDocUrl && (
              <input style={inputStyle} type="text" placeholder="Link label"
                value={editForm.googleDocTitle || ''} onChange={e => setEditForm(f => ({ ...f, googleDocTitle: e.target.value }))} />
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="submit" disabled={busy} style={smallBtn(true)}>{busy ? 'Saving...' : 'Save'}</button>
          <button type="button" onClick={() => { setEditingId(null); setEditForm({}) }} style={smallBtn(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  function renderHomeworkItem(note) {
    if (editingId === note.id) return renderEditForm(note)
    return (
      <div key={note.id} style={itemStyle(note.completed)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <input
            type="checkbox"
            checked={!!note.completed}
            onChange={() => handleToggle(note)}
            style={{ marginTop: '2px', cursor: 'pointer', flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>{note.title}</span>
            {note.date && (
              <span style={{ color: T.muted, fontSize: '10px', marginLeft: '8px' }}>{note.date}</span>
            )}
            {note.subject && (
              <span style={{ fontFamily: 'monospace', fontSize: '9px', padding: '1px 5px', border: `1px solid ${T.border}`, color: T.muted, marginLeft: '6px' }}>
                {note.subject}
              </span>
            )}
            {note.content && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: T.brown, whiteSpace: 'pre-wrap' }}>{note.content}</p>
            )}
            {note.googleDocUrl && (
              <a
                href={note.googleDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontFamily: 'monospace', fontSize: '11px', color: '#3a5a8a',
                  marginTop: '6px', textDecoration: 'none', borderBottom: '1px solid rgba(58,90,138,0.3)',
                }}
              >
                📄 {note.googleDocTitle || 'Open Google Doc'}
              </a>
            )}
          </div>
          <button style={{ ...dangerBtn, color: T.muted, borderColor: T.border, marginLeft: 0, marginRight: '4px' }}
            onClick={() => { setEditingId(note.id); setEditForm({ title: note.title, content: note.content, date: note.date, subject: note.subject, googleDocUrl: note.googleDocUrl, googleDocTitle: note.googleDocTitle }) }}>
            ✎
          </button>
          {isAdmin && (
            <button style={dangerBtn} onClick={() => handleDelete(note.id)}>✕</button>
          )}
        </div>
      </div>
    )
  }

  function renderRecapItem(note) {
    if (editingId === note.id) return renderEditForm(note)
    return (
      <div key={note.id} style={itemStyle(false)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>{note.title}</span>
            {note.date && (
              <span style={{ color: T.muted, fontSize: '10px', marginLeft: '8px' }}>{note.date}</span>
            )}
            {note.subject && (
              <span style={{ fontFamily: 'monospace', fontSize: '9px', padding: '1px 5px', border: `1px solid ${T.border}`, color: T.muted, marginLeft: '6px' }}>
                {note.subject}
              </span>
            )}
            {note.content && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: T.brown, whiteSpace: 'pre-wrap' }}>{note.content}</p>
            )}
          </div>
          <button style={{ ...dangerBtn, color: T.muted, borderColor: T.border, marginLeft: 0, marginRight: '4px' }}
            onClick={() => { setEditingId(note.id); setEditForm({ title: note.title, content: note.content, date: note.date, subject: note.subject, googleDocUrl: note.googleDocUrl, googleDocTitle: note.googleDocTitle }) }}>
            ✎
          </button>
          {isAdmin && (
            <button style={dangerBtn} onClick={() => handleDelete(note.id)}>✕</button>
          )}
        </div>
      </div>
    )
  }

  function renderNoteItem(note) {
    if (editingId === note.id) return renderEditForm(note)
    return (
      <div key={note.id} style={itemStyle(false)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>{note.title}</span>
            {note.subject && (
              <span style={{ fontFamily: 'monospace', fontSize: '9px', padding: '1px 5px', border: `1px solid ${T.border}`, color: T.muted, marginLeft: '6px' }}>
                {note.subject}
              </span>
            )}
            {note.content && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: T.brown, whiteSpace: 'pre-wrap' }}>{note.content}</p>
            )}
          </div>
          <button style={{ ...dangerBtn, color: T.muted, borderColor: T.border, marginLeft: 0, marginRight: '4px' }}
            onClick={() => { setEditingId(note.id); setEditForm({ title: note.title, content: note.content, date: note.date, subject: note.subject, googleDocUrl: note.googleDocUrl, googleDocTitle: note.googleDocTitle }) }}>
            ✎
          </button>
          <button style={dangerBtn} onClick={() => handleDelete(note.id)}>✕</button>
        </div>
      </div>
    )
  }

  // ── Admin add form (homework or recap)
  function renderAdminForm() {
    return (
      <form onSubmit={handleAddAdmin} style={{ border: `1px solid ${T.border}`, background: '#f5f0e8', padding: '12px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <select
            value={adminForm.type}
            onChange={e => setAdminForm(f => ({ ...f, type: e.target.value }))}
            style={{ ...inputStyle, width: 'auto', marginBottom: 0 }}
          >
            <option value="homework">Homework</option>
            <option value="recap">Recap</option>
          </select>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: '120px', marginBottom: 0 }}
            type="date"
            value={adminForm.date}
            onChange={e => setAdminForm(f => ({ ...f, date: e.target.value }))}
          />
        </div>
        {subjects.length > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <select
              value={adminForm.subject}
              onChange={e => setAdminForm(f => ({ ...f, subject: e.target.value }))}
              style={{ ...inputStyle, marginBottom: 0 }}
            >
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <input
          style={inputStyle}
          type="text"
          placeholder="Title *"
          value={adminForm.title}
          onChange={e => setAdminForm(f => ({ ...f, title: e.target.value }))}
          required
        />
        <textarea
          style={textareaStyle}
          placeholder="Content (optional)"
          value={adminForm.content}
          onChange={e => setAdminForm(f => ({ ...f, content: e.target.value }))}
        />
        {adminForm.type === 'homework' && (
          <div style={{ marginBottom: '6px' }}>
            <input
              style={{ ...inputStyle, marginBottom: '4px' }}
              type="url"
              placeholder="Google Doc URL (optional)"
              value={adminForm.googleDocUrl}
              onChange={e => setAdminForm(f => ({ ...f, googleDocUrl: e.target.value }))}
            />
            {adminForm.googleDocUrl && (
              <input
                style={inputStyle}
                type="text"
                placeholder="Link label (e.g. 'Week 3 Exercises')"
                value={adminForm.googleDocTitle}
                onChange={e => setAdminForm(f => ({ ...f, googleDocTitle: e.target.value }))}
              />
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="submit" disabled={busy} style={smallBtn(true)}>{busy ? 'Adding...' : 'Add'}</button>
          <button type="button" onClick={() => setShowForm(null)} style={smallBtn(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  // ── Student add note form
  function renderNoteForm() {
    return (
      <form onSubmit={handleAddNote} style={{ border: `1px solid ${T.border}`, background: '#f5f0e8', padding: '12px', marginBottom: '8px' }}>
        <input
          style={inputStyle}
          type="text"
          placeholder="Title *"
          value={noteForm.title}
          onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
          required
        />
        <textarea
          style={textareaStyle}
          placeholder="Content (optional)"
          value={noteForm.content}
          onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="submit" disabled={busy} style={smallBtn(true)}>{busy ? 'Adding...' : 'Add'}</button>
          <button type="button" onClick={() => setShowForm(null)} style={smallBtn(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  if (loading) {
    return <p style={{ fontFamily: 'monospace', fontSize: '12px', color: T.muted, padding: '8px 0' }}>Loading notes...</p>
  }

  return (
    <div style={{ fontFamily: 'monospace', color: T.ink, padding: '12px 0' }}>

      {/* Subject tabs */}
      {subjects.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {['All', ...subjects].map(sub => (
            <button
              key={sub}
              onClick={() => setActiveSubject(sub)}
              style={{
                fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em',
                textTransform: 'uppercase', padding: '4px 10px', border: '1px solid',
                cursor: 'pointer', transition: 'all 0.15s',
                background: activeSubject === sub ? T.ink : 'transparent',
                borderColor: activeSubject === sub ? T.ink : T.border,
                color: activeSubject === sub ? T.cream : T.brown,
              }}
            >{sub}</button>
          ))}
        </div>
      )}

      {/* ── Homework ── */}
      <div style={{ marginBottom: '20px' }}>
        <p style={sectionHeader}>Homework</p>
        {homework.length === 0 && (
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: T.muted, marginBottom: '8px' }}>No homework assigned.</p>
        )}
        {homework.map(renderHomeworkItem)}
        {isAdmin && showForm === 'homework' && renderAdminForm()}
        {isAdmin && showForm !== 'homework' && (
          <button style={smallBtn(false)} onClick={() => { setAdminForm({ ...BLANK_ADMIN, type: 'homework' }); setShowForm('homework') }}>
            + Add Homework
          </button>
        )}
      </div>

      {/* ── Lesson Recaps ── */}
      <div style={{ marginBottom: '20px' }}>
        <p style={sectionHeader}>Lesson Recaps</p>
        {recaps.length === 0 && (
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: T.muted, marginBottom: '8px' }}>No recaps yet.</p>
        )}
        {recaps.map(renderRecapItem)}
        {isAdmin && showForm === 'recap' && renderAdminForm()}
        {isAdmin && showForm !== 'recap' && (
          <button style={smallBtn(false)} onClick={() => { setAdminForm({ ...BLANK_ADMIN, type: 'recap' }); setShowForm('recap') }}>
            + Add Recap
          </button>
        )}
      </div>

      {/* ── My Notes ── */}
      <div style={{ marginBottom: '8px' }}>
        <p style={sectionHeader}>My Notes</p>
        {myNotes.length === 0 && (
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: T.muted, marginBottom: '8px' }}>No personal notes yet.</p>
        )}
        {myNotes.map(renderNoteItem)}
        {showForm === 'note' && renderNoteForm()}
        {showForm !== 'note' && (
          <button style={smallBtn(false)} onClick={() => setShowForm('note')}>
            + Add Note
          </button>
        )}
      </div>

    </div>
  )
}
