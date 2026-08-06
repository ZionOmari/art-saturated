import { useState, useEffect } from 'react'
import { getTasksForDate, addTask, toggleTask, deleteTask, TASK_TYPES } from '../data/tasks'

const TYPE_KEYS = Object.keys(TASK_TYPES)

function fmt(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

const inp = {
  fontFamily: 'monospace', fontSize: '12px', padding: '8px 12px',
  border: '1px solid #d4c9bb', background: 'rgba(250,248,244,0.8)',
  color: '#1a1208', outline: 'none', width: '100%', boxSizing: 'border-box',
}

const typeBtn = (active, type) => ({
  fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.08em',
  textTransform: 'uppercase', padding: '4px 8px', border: '1px solid', cursor: 'pointer',
  transition: 'all 0.12s',
  background: active ? TASK_TYPES[type].color : 'transparent',
  color:      active ? '#fff' : TASK_TYPES[type].color,
  borderColor: TASK_TYPES[type].color,
})

export default function DailyPlanner({ date, onTaskChange }) {
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(false)
  const [title,   setTitle]   = useState('')
  const [notes,   setNotes]   = useState('')
  const [type,    setType]    = useState('task')
  const [adding,  setAdding]  = useState(false)
  const [busy,    setBusy]    = useState(false)

  useEffect(() => {
    if (!date) return
    setLoading(true)
    getTasksForDate(date).then(t => { setTasks(t); setLoading(false) })
  }, [date])

  async function handleAdd(e) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    await addTask({ date, title: title.trim(), type, notes: notes.trim() })
    const updated = await getTasksForDate(date)
    setTasks(updated)
    setTitle(''); setNotes(''); setType('task'); setAdding(false)
    setBusy(false)
    onTaskChange?.()
  }

  async function handleToggle(id, done) {
    await toggleTask(id, !done)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !done } : t))
    onTaskChange?.()
  }

  async function handleDelete(id) {
    await deleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    onTaskChange?.()
  }

  if (!date) return null

  const pending   = tasks.filter(t => !t.done)
  const completed = tasks.filter(t =>  t.done)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#7a4ac8', margin: 0 }}>
          ✦ Daily Plan
        </p>
        <button onClick={() => setAdding(a => !a)} style={{
          fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em',
          background: adding ? '#1a1208' : 'transparent', color: adding ? '#fff' : '#8a5c3a',
          border: '1px solid #d4c9bb', cursor: 'pointer', padding: '3px 10px',
        }}>
          {adding ? '✕ Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px solid #d4c9bb', background: 'rgba(250,248,244,0.5)' }}>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Task title…" style={inp} autoFocus />
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)…" style={{ ...inp, fontSize: '11px' }} />

          {/* Type pills */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {TYPE_KEYS.map(k => (
              <button key={k} type="button" onClick={() => setType(k)} style={typeBtn(type === k, k)}>
                {TASK_TYPES[k].label}
              </button>
            ))}
          </div>

          <button type="submit" disabled={busy || !title.trim()} style={{
            fontFamily: 'monospace', fontSize: '11px', padding: '8px', border: '1px solid #1a1208',
            background: '#1a1208', color: '#f2ebe0', cursor: 'pointer', letterSpacing: '0.08em',
          }}>
            {busy ? '…' : 'Add to Plan'}
          </button>
        </form>
      )}

      {loading && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898' }}>Loading…</p>}

      {/* Pending tasks */}
      {!loading && pending.length === 0 && !adding && (
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898', fontStyle: 'italic' }}>
          Nothing planned — hit + Add to schedule tasks for {fmt(date)}.
        </p>
      )}

      {pending.map(task => <TaskRow key={task.id} task={task} onToggle={handleToggle} onDelete={handleDelete} />)}

      {/* Completed */}
      {completed.length > 0 && (
        <div style={{ borderTop: '1px solid #ece6dc', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#b0a898', margin: 0 }}>Done</p>
          {completed.map(task => <TaskRow key={task.id} task={task} onToggle={handleToggle} onDelete={handleDelete} />)}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete }) {
  const meta = TASK_TYPES[task.type] || TASK_TYPES.task
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px',
      background: task.done ? 'transparent' : meta.bg,
      border: `1px solid ${task.done ? '#ece6dc' : meta.color}22`,
      opacity: task.done ? 0.55 : 1, transition: 'opacity 0.15s',
    }}>
      {/* Checkbox */}
      <button onClick={() => onToggle(task.id, task.done)} style={{
        width: '16px', height: '16px', minWidth: '16px', border: `1px solid ${meta.color}`,
        background: task.done ? meta.color : 'transparent', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px',
      }}>
        {task.done && <span style={{ color: '#fff', fontSize: '10px', lineHeight: 1 }}>✓</span>}
      </button>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', textDecoration: task.done ? 'line-through' : 'none' }}>
            {task.title}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', padding: '1px 6px', background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44`, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
            {meta.label}
          </span>
          {task.orderId && (
            <span style={{ fontFamily: 'monospace', fontSize: '9px', color: '#b0a898' }}>#{task.orderId.slice(-6)}</span>
          )}
        </div>
        {task.notes && (
          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', margin: '3px 0 0', lineHeight: 1.5 }}>{task.notes}</p>
        )}
      </div>

      {/* Delete */}
      <button onClick={() => onDelete(task.id)} style={{
        background: 'none', border: 'none', cursor: 'pointer', color: '#c8bfb0',
        fontSize: '12px', lineHeight: 1, padding: '0', marginTop: '1px',
      }}>✕</button>
    </div>
  )
}
