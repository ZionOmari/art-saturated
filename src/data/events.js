import {
  collection, doc, addDoc, getDocs, deleteDoc, updateDoc, setDoc,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

// Local-timezone YYYY-MM-DD (NOT UTC). Using new Date().toISOString() here would roll
// over to "tomorrow" after ~8pm Eastern, which hid tonight's events as if already past.
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getUpcomingEvents() {
  const today = todayStr()
  const snap  = await getDocs(
    query(
      collection(db, 'events'),
      where('approved', '==', true),
      where('date', '>=', today),
      orderBy('date', 'asc'),
    )
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getAllEvents() {
  const snap = await getDocs(query(collection(db, 'events'), orderBy('date', 'asc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getPastEvents() {
  const today = todayStr()
  const snap  = await getDocs(
    query(
      collection(db, 'events'),
      where('approved', '==', true),
      where('date', '<', today),
      orderBy('date', 'desc'),
    )
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function addEvent(fields) {
  return addDoc(collection(db, 'events'), {
    title:        fields.title        || '',
    subtitle:     fields.subtitle     || '',
    date:         fields.date         || '',
    time:         fields.startTime    || fields.time || '',
    startTime:    fields.startTime    || fields.time || '',
    endTime:      fields.endTime      || '',
    eventType:    fields.eventType    || '',
    location:     fields.location     || '',
    description:  fields.description  || '',
    flyerURL:     fields.flyerURL     || '',
    entryFee:     fields.entryFee     || '',
    allAges:      fields.allAges      ?? true,
    alcohol:      fields.alcohol      ?? false,
    food:         fields.food         ?? false,
    submitterUid: fields.submitterUid || fields.uid || '',
    approved:     true,
    createdAt:    serverTimestamp(),
  })
}

export async function updateEvent(id, fields) {
  await updateDoc(doc(db, 'events', id), {
    title:       fields.title       || '',
    subtitle:    fields.subtitle    || '',
    date:        fields.date        || '',
    time:        fields.startTime   || fields.time || '',
    startTime:   fields.startTime   || fields.time || '',
    endTime:     fields.endTime     || '',
    eventType:   fields.eventType   || '',
    location:    fields.location    || '',
    description: fields.description || '',
    flyerURL:    fields.flyerURL    !== undefined ? fields.flyerURL : '',
    entryFee:    fields.entryFee    || '',
    allAges:     fields.allAges     ?? true,
    alcohol:     fields.alcohol     ?? false,
    food:        fields.food        ?? false,
    updatedAt:   serverTimestamp(),
  })
}

export async function deleteEvent(id) {
  await deleteDoc(doc(db, 'events', id))
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function submitEventRequest(fields, uid, displayName, email) {
  return addDoc(collection(db, 'eventSubmissions'), {
    title:       fields.title       || '',
    date:        fields.date        || '',
    startTime:   fields.startTime   || '',
    endTime:     fields.endTime     || '',
    eventType:   fields.eventType   || '',
    location:    fields.location    || '',
    description: fields.description || '',
    entryFee:    fields.entryFee    || '',
    allAges:     fields.allAges     ?? true,
    alcohol:     fields.alcohol     ?? false,
    food:        fields.food        ?? false,
    uid,
    submittedBy:    displayName || '',
    submitterEmail: email       || '',
    status:         'pending',
    submittedAt:    serverTimestamp(),
  })
}

export async function getSubmissions() {
  const snap = await getDocs(
    query(collection(db, 'eventSubmissions'), orderBy('submittedAt', 'desc'))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getMySubmissions(uid) {
  const snap = await getDocs(
    query(
      collection(db, 'eventSubmissions'),
      where('uid', '==', uid),
      orderBy('submittedAt', 'desc'),
    )
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function approveSubmission(id, sub) {
  const ref = await addEvent(sub)
  await updateDoc(doc(db, 'eventSubmissions', id), {
    status:  'approved',
    eventId: ref.id,
  })
  return ref.id
}

export async function denySubmission(id) {
  await updateDoc(doc(db, 'eventSubmissions', id), { status: 'denied' })
}

/** User requests changes to an already-approved event */
export async function requestEventEdit(submissionId, fields) {
  await updateDoc(doc(db, 'eventSubmissions', submissionId), {
    title:           fields.title        || '',
    subtitle:        fields.subtitle     || '',
    date:            fields.date         || '',
    startTime:       fields.startTime    || '',
    endTime:         fields.endTime      || '',
    eventType:       fields.eventType    || '',
    location:        fields.location     || '',
    description:     fields.description  || '',
    entryFee:        fields.entryFee     || '',
    allAges:         fields.allAges      ?? true,
    alcohol:         fields.alcohol      ?? false,
    food:            fields.food         ?? false,
    status:          'edit_requested',
    editRequestedAt: serverTimestamp(),
  })
}

/** Admin applies an approved edit — updates the live events doc */
export async function applyEventEdit(submissionId, eventId, fields) {
  await updateEvent(eventId, fields)
  await updateDoc(doc(db, 'eventSubmissions', submissionId), {
    status:       'approved',
    editAppliedAt: serverTimestamp(),
  })
}

/** Admin denies an edit request — reverts submission to approved, event unchanged */
export async function denyEventEdit(submissionId) {
  await updateDoc(doc(db, 'eventSubmissions', submissionId), {
    status: 'approved',
    editDeniedAt: serverTimestamp(),
  })
}

export async function withdrawSubmission(id) {
  await deleteDoc(doc(db, 'eventSubmissions', id))
}

export async function updateSubmission(id, fields) {
  await updateDoc(doc(db, 'eventSubmissions', id), {
    title:       fields.title       || '',
    subtitle:    fields.subtitle    || '',
    date:        fields.date        || '',
    startTime:   fields.startTime   || '',
    endTime:     fields.endTime     || '',
    eventType:   fields.eventType   || '',
    location:    fields.location    || '',
    description: fields.description || '',
    entryFee:    fields.entryFee    || '',
    allAges:     fields.allAges     ?? true,
    alcohol:     fields.alcohol     ?? false,
    food:        fields.food        ?? false,
    status:      'pending',
  })
}

// Remove an approved event from the calendar (poster-requested)
export async function requestEventRemoval(submissionId, eventTitle) {
  // Mark submission as removal-requested; admin handles cleanup
  await updateDoc(doc(db, 'eventSubmissions', submissionId), {
    status:           'removal_requested',
    removalRequestAt: serverTimestamp(),
  })
}

// ── User event notification preference ───────────────────────────────────────

export async function setEventNotifyPref(uid, value) {
  await setDoc(doc(db, 'users', uid), { notifyEvents: value }, { merge: true })
}
