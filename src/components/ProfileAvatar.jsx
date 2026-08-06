import { useRef, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { doc, setDoc } from 'firebase/firestore'
import { storage, db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import CropModal from './CropModal'

export default function ProfileAvatar({ size = 96, showUpload = false }) {
  const { user, profile, setProfile } = useAuth()
  const fileRef   = useRef()
  const [busy,        setBusy]        = useState(false)
  const [cropPending, setCropPending] = useState(null)

  const initials = (profile?.name || user?.displayName || '?')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setCropPending({ file, preview: URL.createObjectURL(file) })
    e.target.value = ''
  }

  async function handleCropConfirm(croppedFile) {
    setCropPending(null)
    setBusy(true)
    try {
      const imgRef   = ref(storage, `avatars/${user.uid}`)
      const snap     = await uploadBytes(imgRef, croppedFile)
      const photoURL = await getDownloadURL(snap.ref)
      await setDoc(doc(db, 'users', user.uid), { photoURL }, { merge: true })
      if (setProfile) setProfile(p => ({ ...p, photoURL }))
    } catch (err) {
      console.error(err)
    } finally { setBusy(false) }
  }

  const photoURL = profile?.photoURL || user?.photoURL

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      {/* Avatar */}
      <div style={{
        width: size, height: size, borderRadius: '50%',
        overflow: 'hidden', background: '#2a1a0e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '2px solid #d4c9bb',
        cursor: showUpload ? 'pointer' : 'default',
        position: 'relative',
      }}
        onClick={() => showUpload && fileRef.current?.click()}
      >
        {photoURL ? (
          <img src={photoURL} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontFamily: 'serif', fontSize: size * 0.35, color: '#f2ebe0', userSelect: 'none' }}>
            {initials}
          </span>
        )}

        {/* Upload overlay */}
        {showUpload && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'rgba(0,0,0,0.45)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            opacity: busy ? 1 : 0, transition: 'opacity 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => !busy && (e.currentTarget.style.opacity = '0')}
          >
            <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#f2ebe0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {busy ? '...' : 'Edit'}
            </span>
          </div>
        )}
      </div>



      {/* Hidden file input */}
      {showUpload && (
        <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
      )}

      {cropPending && (
        <CropModal
          file={cropPending.file}
          preview={cropPending.preview}
          defaultAspect={1}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropPending(null)}
        />
      )}
    </div>
  )
}
