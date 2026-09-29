import {
  collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  doc, query, where, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export async function getPublishedPosts(artistUid) {
  const snap = await getDocs(query(
    collection(db, 'blogPosts'),
    where('artistUid', '==', artistUid),
    where('published', '==', true),
    orderBy('publishedAt', 'desc'),
  ))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getArtistPosts(artistUid) {
  const snap = await getDocs(query(
    collection(db, 'blogPosts'),
    where('artistUid', '==', artistUid),
    orderBy('createdAt', 'desc'),
  ))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getPost(postId) {
  const snap = await getDoc(doc(db, 'blogPosts', postId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function createPost({ artistUid, title, body }) {
  return addDoc(collection(db, 'blogPosts'), {
    artistUid,
    title,
    body,
    published: false,
    publishedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updatePost(postId, { title, body }) {
  await updateDoc(doc(db, 'blogPosts', postId), {
    title,
    body,
    updatedAt: serverTimestamp(),
  })
}

export async function publishPost(postId) {
  await updateDoc(doc(db, 'blogPosts', postId), {
    published: true,
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function unpublishPost(postId) {
  await updateDoc(doc(db, 'blogPosts', postId), {
    published: false,
    updatedAt: serverTimestamp(),
  })
}

export async function deletePost(postId) {
  await deleteDoc(doc(db, 'blogPosts', postId))
}
