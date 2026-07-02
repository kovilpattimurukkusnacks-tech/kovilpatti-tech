import { useEffect, useRef } from 'react'

/**
 * Fires the browser print dialog ONCE per page life, 300ms after `ready`
 * flips to true. Without the ref guard, React Query data refetches (or
 * StrictMode double-invoke in dev) can queue multiple window.print() calls
 * — which leaves "ghost" dialogs that lock both this tab and its opener.
 *
 * Shared by PrintCumulative / PrintRequestPicklist / PrintRequestThermal.
 * `ready` should flip to true exactly once the data needed for the printout
 * has arrived (e.g. `!!rows` or `!!request`).
 */
export function useAutoPrint(ready: boolean) {
  const printedRef = useRef(false)
  useEffect(() => {
    if (!ready || printedRef.current) return
    printedRef.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [ready])
}

/**
 * Shared on-screen "Print" button for the print pages. Visibility on the
 * printed page itself is controlled by the caller's className (e.g. the
 * `print-only` / `print-footer` wrappers already applied around it).
 */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button onClick={() => window.print()} className={className}>
      Print
    </button>
  )
}
