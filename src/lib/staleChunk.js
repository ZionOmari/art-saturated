// After a deploy, a tab that's already open still runs the old index.html,
// which points at page files (chunks) the deploy replaced. The next lazy page
// load then fails. Reloading pulls the new index.html and fixes it.
//
// Guard: reload at most once per 10 seconds, so a genuinely broken deploy
// can't send the page into a reload loop — but a tab that lives through
// several deploys still recovers each time.
const KEY = 'chunkReloadAt'
const WINDOW_MS = 10000

export function isChunkLoadError(err) {
  return err?.name === 'ChunkLoadError'
    || /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
      .test(err?.message || '')
}

let reloading = false

/** True once a reload has been started — show a loader, not an error, until it lands. */
export const isReloading = () => reloading

/** Reloads the page if allowed. Returns true when a reload was started (or already is). */
export function reloadForStaleChunk() {
  if (reloading) return true
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch {}
  if (Date.now() - last < WINDOW_MS) return false
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch {}
  reloading = true
  window.location.reload()
  return true
}
