import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

// ── Task types ────────────────────────────────────────────────────────────────
export const TASK_TYPES = {
  task:       { label: 'Task',              color: '#8a5c3a', bg: 'rgba(122,111,100,0.10)', dot: '#8a5c3a' },
  admin:      { label: 'Admin',             color: '#4a2a7a', bg: 'rgba(74,42,122,0.10)',   dot: '#7a4ac8' },
  shipping:   { label: 'Ship Deadline',     color: '#b95a20', bg: 'rgba(185,90,32,0.10)',   dot: '#d4722a' },
  commission: { label: 'Commission Due',    color: '#b97a20', bg: 'rgba(185,122,32,0.10)',  dot: '#d4a030' },
  deadline:   { label: 'Deadline',          color: '#7a2020', bg: 'rgba(122,32,32,0.10)',   dot: '#c84040' },
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function getTasksForDate(dateStr) {
  const q    = query(collection(db, 'tasks'), where('date', '==', dateStr))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
}

export async function getTasksForRange(startStr, endStr) {
  const q    = query(collection(db, 'tasks'), where('date', '>=', startStr), where('date', '<=', endStr))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function addTask({ date, title, type = 'task', notes = '', orderId = null, time = null }) {
  const ref = await addDoc(collection(db, 'tasks'), {
    date, title, type,
    notes:   notes   || '',
    orderId: orderId || null,
    time:    time    || null,
    done:    false,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function toggleTask(id, done) {
  await updateDoc(doc(db, 'tasks', id), { done })
}

export async function deleteTask(id) {
  await deleteDoc(doc(db, 'tasks', id))
}

export async function updateTask(id, updates) {
  await updateDoc(doc(db, 'tasks', id), updates)
}

// ── Deadline helpers ──────────────────────────────────────────────────────────
// Add N business days to a date string, return YYYY-MM-DD
export function addBusinessDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  let date = new Date(y, m - 1, d)
  let added = 0
  while (added < n) {
    date.setDate(date.getDate() + 1)
    const dow = date.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
