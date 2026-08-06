import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

// Private personal-collection archive. Admin-only by Firestore rules — these
// items never appear in the shop, hero, or any public query (separate collection).

export async function fetchArchive() {
  const snap = await getDocs(query(collection(db, 'archive'), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function addArchiveItem(data) {
  const { _imgFile, id, ...rest } = data
  return addDoc(collection(db, 'archive'), {
    ...rest,
    createdAt: serverTimestamp(),
    source:    'collection',
  })
}

export async function updateArchiveItem(id, data) {
  const { id: _id, createdAt, _imgFile, ...rest } = data
  await updateDoc(doc(db, 'archive', id), rest)
}

export async function deleteArchiveItem(id) {
  await deleteDoc(doc(db, 'archive', id))
}
