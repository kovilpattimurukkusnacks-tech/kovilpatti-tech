import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'

/**
 * Two-layer "you have unsaved changes" guard.
 *
 * Layer 1 — React Router's `useBlocker`: intercepts in-app navigation (link
 *   clicks, sidebar menu, programmatic `navigate()`). Surfaces a `blocker`
 *   object the caller drives via a custom modal: `proceed()` to continue
 *   navigation, `reset()` to stay.
 *
 * Layer 2 — `beforeunload`: catches browser-level navigation that React
 *   Router can't see (refresh, back/forward outside of app, tab close,
 *   typing a new URL). The browser shows its OWN generic confirmation
 *   dialog; we can't customise the text in modern browsers. The user
 *   still gets a chance to bail out — we just can't offer "save as draft"
 *   here because the page is being torn down.
 *
 * The hook takes a `shouldBlock` GETTER rather than a boolean. This lets
 * the caller compose ref-driven signals (e.g. a `submittingRef` flipped
 * synchronously inside a submit handler) that need to be visible to the
 * blocker callback *before* the next React render. A boolean argument
 * would close over the previous render's value, causing the guard to
 * false-fire on legitimate submit-then-navigate flows.
 *
 * Pattern in the caller:
 *
 *   const submittingRef = useRef(false)
 *   const guard = useUnsavedChangesGuard(
 *     () => !submittingRef.current && isDraftDirty,
 *   )
 *   // …in handleSubmit, before navigate():
 *   submittingRef.current = true
 *   navigate('/somewhere')
 */
export function useUnsavedChangesGuard(shouldBlock: () => boolean) {
  // Hold the latest getter in a ref so the callbacks below always read the
  // current closure without needing to re-subscribe. Updated inline during
  // render — useEffect would lag a tick and the BE-mutation→navigate flow
  // calls these callbacks synchronously inside the same event tick.
  const shouldBlockRef = useRef(shouldBlock)
  shouldBlockRef.current = shouldBlock

  // Only block when the pathname actually changes — query-string-only nav
  // (e.g. filter toggles via setSearchParams) shouldn't trigger the modal.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && shouldBlockRef.current())

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!shouldBlockRef.current()) return
      // Modern browsers ignore custom text and show their own generic
      // message — but `preventDefault` + assigning `returnValue` is still
      // required to actually trigger the prompt on refresh / tab-close.
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  return blocker
}
