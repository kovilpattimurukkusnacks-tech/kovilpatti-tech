import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, AlertTriangle, Info, X, AlertOctagon } from 'lucide-react'

/**
 * App-wide toast system (07-Jul-2026 client pick: Rich Card style).
 *
 * Purpose-built for this app — no external dep. Each toast is a rich card
 * with an icon block, bold title, optional description sub-line, close X,
 * and a colored severity rail. Stacks top-right; slides in from the right,
 * out to the right on dismiss.
 *
 * API (backward-compatible with the string-only calls in useStockRequests.ts):
 *
 *   const toast = useToast()
 *   toast.success('Request REQ0042 approved')                  // simple
 *   toast.success({                                             // rich
 *     title: 'Request approved',
 *     description: 'REQ0042 is now In-Progress · shop notified',
 *   })
 *
 * Every level (success / error / info / warning) accepts either form.
 *
 * Behaviour:
 *   • Auto-dismiss: 3s for success/info, 4s for warning, 5s for error.
 *     Errors need longer read time. Hovering pauses the timer so the
 *     user can finish reading if they're actively looking at it.
 *   • Stack cap: 5 visible. Older toasts drop off the top when a 6th
 *     is fired — prevents a runaway loop from covering the screen.
 *   • Reduced motion: honors prefers-reduced-motion; animations swap
 *     for instant show/hide.
 *   • Escape key dismisses every open toast (keyboard rescue).
 */

type ToastKind = 'success' | 'error' | 'warning' | 'info'
type ToastInput = string | { title: string; description?: string }
type Toast = {
  id: number
  kind: ToastKind
  title: string
  description?: string
  paused: boolean
  createdAt: number
  duration: number
}

interface ToastApi {
  success: (input: ToastInput) => void
  error:   (input: ToastInput) => void
  warning: (input: ToastInput) => void
  info:    (input: ToastInput) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

const DURATIONS: Record<ToastKind, number> = {
  success: 3000,
  info:    3000,
  warning: 4000,
  error:   5000,
}

const MAX_STACK = 5

let nextId = 1

function normalize(input: ToastInput): { title: string; description?: string } {
  return typeof input === 'string' ? { title: input } : input
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, input: ToastInput) => {
    const { title, description } = normalize(input)
    setToasts(prev => {
      const t: Toast = {
        id: nextId++,
        kind,
        title,
        description,
        paused: false,
        createdAt: Date.now(),
        duration: DURATIONS[kind],
      }
      // Cap the stack — drop the oldest when we're over.
      const next = [...prev, t]
      return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next
    })
  }, [])

  // Escape → dismiss every open toast. Small keyboard rescue for a stack
  // that piled up unintentionally.
  useEffect(() => {
    if (toasts.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToasts([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toasts.length])

  const api = useMemo<ToastApi>(() => ({
    success: (i) => push('success', i),
    error:   (i) => push('error',   i),
    warning: (i) => push('warning', i),
    info:    (i) => push('info',    i),
  }), [push])

  const setPaused = useCallback((id: number, paused: boolean) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, paused } : t))
  }, [])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} onPausedChange={setPaused} />
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be called inside <ToastProvider>')
  return ctx
}

// ────────────────────────────────────────────────────────────────────────
// Presentation
// ────────────────────────────────────────────────────────────────────────

function ToastStack({
  toasts, onDismiss, onPausedChange,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
  onPausedChange: (id: number, paused: boolean) => void
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: 'fixed',
        // Top-center anchor (07-Jul-2026, client pick). `left: 50%` +
        // `translateX(-50%)` centres the column against the viewport
        // regardless of card width; `maxWidth` caps the stack so a long
        // toast doesn't span edge-to-edge on wide monitors.
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'none',
        maxWidth: 600,
        width: 'auto',
      }}
    >
      {toasts.map(t => (
        <ToastCard
          key={t.id}
          toast={t}
          onDismiss={() => onDismiss(t.id)}
          onPausedChange={(paused) => onPausedChange(t.id, paused)}
        />
      ))}
    </div>
  )
}

// 07-Jul-2026: bumped from a subtle white-with-rail card to a bold, fully
// colored card per severity — the top-center anchor invites more visual
// weight than the old corner treatment did. Palette per kind now covers:
//   • gradient — the card's solid background, tuned so both stops read
//     clearly against the app's cream/amber page background.
//   • iconBg   — the darker inner shade for the icon square (contrasts
//     against the card body).
//   • shadow   — a colored shadow matching the palette, replaces the neutral
//     grey drop-shadow so the toast feels lit-from-within.
const PALETTE: Record<ToastKind, {
  gradient: string; iconBg: string; shadow: string;
}> = {
  success: {
    gradient: 'linear-gradient(135deg, #2E7D32 0%, #43A047 55%, #66BB6A 100%)',
    iconBg:   'rgba(255, 255, 255, 0.22)',
    shadow:   '0 24px 48px rgba(46, 125, 50, 0.35), 0 6px 14px rgba(46, 125, 50, 0.25)',
  },
  error: {
    gradient: 'linear-gradient(135deg, #B71C1C 0%, #D32F2F 55%, #E53935 100%)',
    iconBg:   'rgba(255, 255, 255, 0.22)',
    shadow:   '0 24px 48px rgba(183, 28, 28, 0.38), 0 6px 14px rgba(183, 28, 28, 0.25)',
  },
  warning: {
    gradient: 'linear-gradient(135deg, #E65100 0%, #F57C00 55%, #FB8C00 100%)',
    iconBg:   'rgba(255, 255, 255, 0.24)',
    shadow:   '0 24px 48px rgba(230, 81, 0, 0.38), 0 6px 14px rgba(230, 81, 0, 0.25)',
  },
  info: {
    gradient: 'linear-gradient(135deg, #01579B 0%, #0277BD 55%, #039BE5 100%)',
    iconBg:   'rgba(255, 255, 255, 0.22)',
    shadow:   '0 24px 48px rgba(1, 87, 155, 0.38), 0 6px 14px rgba(1, 87, 155, 0.25)',
  },
}

function ToastCard({
  toast, onDismiss, onPausedChange,
}: {
  toast: Toast
  onDismiss: () => void
  onPausedChange: (paused: boolean) => void
}) {
  const [leaving, setLeaving] = useState(false)
  const p = PALETTE[toast.kind]

  // Auto-dismiss timer — tracks paused state so hover halts the countdown.
  // Uses elapsed-since-createdAt so a pause/resume never resets the clock
  // to 0 (which would let a hovered toast live for many minutes).
  useEffect(() => {
    if (toast.paused) return
    const elapsed = Date.now() - toast.createdAt
    const remaining = Math.max(0, toast.duration - elapsed)
    const t = window.setTimeout(() => {
      setLeaving(true)
      // Wait for the exit animation to play, then unmount.
      window.setTimeout(onDismiss, 220)
    }, remaining)
    return () => window.clearTimeout(t)
  }, [toast.paused, toast.duration, toast.createdAt, onDismiss])

  const startLeave = () => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(onDismiss, 220)
  }

  const Icon = toast.kind === 'success' ? Check
    : toast.kind === 'error'   ? AlertOctagon
    : toast.kind === 'warning' ? AlertTriangle
    : Info

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => onPausedChange(true)}
      onMouseLeave={() => onPausedChange(false)}
      onFocus={() => onPausedChange(true)}
      onBlur={() => onPausedChange(false)}
      style={{
        pointerEvents: 'auto',
        // Bold colored card (07-Jul-2026 client req: "bigger and colorful").
        // Gradient background per severity, white content — reads at a
        // glance from across the room. Colored shadow tint replaces the
        // neutral grey drop, so the toast feels lit from within.
        background: p.gradient,
        color: '#FFFFFF',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 14,
        padding: '18px 20px',
        boxShadow: p.shadow,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 16,
        alignItems: 'center',
        minWidth: 420,
        maxWidth: 560,
        position: 'relative',
        overflow: 'hidden',
        animation: leaving
          ? 'kovilpattiToastOut 220ms cubic-bezier(0.32, 0.72, 0, 1) forwards'
          : 'kovilpattiToastIn 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Icon block — larger, translucent-white square so the icon reads
          as bright inside a colored card. Reserved for the primary
          severity glyph. */}
      <div
        aria-hidden
        style={{
          width: 48, height: 48, borderRadius: 12,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: p.iconBg,
          color: '#FFFFFF',
          flexShrink: 0,
          border: '1px solid rgba(255, 255, 255, 0.25)',
        }}
      >
        <Icon size={26} strokeWidth={2.75} />
      </div>

      {/* Title + optional description body — pure white on the colored
          ground, description drops opacity slightly to keep the hierarchy. */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontWeight: 800,
          fontSize: 17,
          lineHeight: 1.35,
          letterSpacing: '-0.005em',
          wordWrap: 'break-word',
          textShadow: '0 1px 1px rgba(0, 0, 0, 0.15)',
        }}>
          {toast.title}
        </div>
        {toast.description && (
          <div style={{
            color: 'rgba(255, 255, 255, 0.92)',
            fontSize: 13.5,
            fontWeight: 500,
            marginTop: 4,
            lineHeight: 1.45,
            wordWrap: 'break-word',
          }}>
            {toast.description}
          </div>
        )}
      </div>

      {/* Close X — semi-transparent white against the colored card,
          brightens on hover. Sized up to match the bigger card. */}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={startLeave}
        style={{
          background: 'rgba(255, 255, 255, 0.15)',
          border: 0,
          cursor: 'pointer',
          padding: 6,
          color: '#FFFFFF',
          alignSelf: 'flex-start',
          borderRadius: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 120ms ease',
        }}
        onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.28)' }}
        onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.15)' }}
      >
        <X size={18} strokeWidth={2.75} />
      </button>
    </div>
  )
}

// One-time keyframes injection — placed in the document head so both
// entrance and exit animations resolve without importing a CSS module.
if (typeof document !== 'undefined' && !document.getElementById('kovilpatti-toast-keyframes')) {
  const s = document.createElement('style')
  s.id = 'kovilpatti-toast-keyframes'
  // Enter drops the card down from above the viewport (matches the
  // top-center anchor); exit lifts it back up. Slight scale for a bit
  // of physical weight without going overboard on motion.
  s.textContent = `
    @keyframes kovilpattiToastIn {
      from { transform: translateY(-24px) scale(0.96); opacity: 0; }
      to   { transform: translateY(0)     scale(1);    opacity: 1; }
    }
    @keyframes kovilpattiToastOut {
      from { transform: translateY(0)     scale(1);    opacity: 1; }
      to   { transform: translateY(-16px) scale(0.98); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes kovilpattiToastIn  { from, to { transform: none; opacity: 1; } }
      @keyframes kovilpattiToastOut { from, to { transform: none; opacity: 0; } }
    }
  `
  document.head.appendChild(s)
}
