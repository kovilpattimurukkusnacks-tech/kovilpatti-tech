import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * PremiumLoginScene — gold-silhouette snacks auto-draw on cream ground.
 *
 * Four snack illustrations sit in the four viewport corners, drawing
 * themselves in sequence like a hand-embossed sweet-shop signboard:
 *
 *   • Murukku      — top-left    (8-lobe rose + inner spiral)
 *   • Boondi laddu — top-right   (outer ring + 30 texture dots)
 *   • Thattai      — bottom-left (outer ring + score marks + dots)
 *   • Jangiri      — bottom-right (6 interlocking rings)
 *
 * Every stroke uses a linear-gradient fill (`GOLD_MID → GOLD_INK →
 * GOLD_DEEP`) so each silhouette reads as gold-foil embossed rather than
 * flat pen-ink — that's the difference between "decorative" and "premium."
 *
 * The centre of the viewport is deliberately empty so the frosted login
 * card sits on clean ground. No snack overlaps the card.
 *
 * Reduced-motion respect: framer-motion `useReducedMotion` short-circuits
 * every draw and drift; the final composition renders instantly.
 */

const GOLD_INK  = '#8A5A1A'
const GOLD_DEEP = '#B8860B'
const GOLD_MID  = '#D4AF37'

type SnackType = 'murukku' | 'laddu' | 'thattai' | 'jangiri'
type SnackPos  = { type: SnackType; left: string; top: string; size: number; delay: number }

// Corner placements — % of viewport, translated -50%/-50% so `left/top`
// point at the CENTRE of each snack (not its top-left corner). Deltas
// chosen so at 1440x900 the four snacks are visually balanced with the
// centred login card.
const SNACK_POSITIONS: SnackPos[] = [
  { type: 'murukku', left: '12%',  top: '18%', size: 240, delay: 0.4 },
  { type: 'laddu',   left: '86%',  top: '16%', size: 210, delay: 1.4 },
  { type: 'thattai', left: '11%',  top: '78%', size: 220, delay: 2.4 },
  { type: 'jangiri', left: '88%',  top: '75%', size: 220, delay: 3.4 },
]

export default function PremiumLoginScene() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        // Cream centre where the login card sits, brand gold at the
        // edges. Same palette as before — the direction that finally
        // worked for the "bright yellow-gold" ask.
        background:
          'radial-gradient(circle at 50% 45%, ' +
          '#FFFDF5 0%, ' +
          '#FFF3C4 28%, ' +
          '#FCD835 68%, ' +
          '#E6B800 100%)',
        overflow: 'hidden',
      }}
    >
      {SNACK_POSITIONS.map((pos, i) => (
        <SnackFrame key={i} {...pos} />
      ))}
      <GoldDust />
    </div>
  )
}

// ═══════════════ Snack frame — positions + shared defs ═══════════════

function SnackFrame({ type, left, top, size, delay }: SnackPos) {
  const gradId = `snackGrad-${type}`
  const glowId = `snackGlow-${type}`
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          {/* Diagonal gold-foil gradient. The mid stop being darkest (not
              lightest) makes the stroke read as reflective metal rather
              than a flat ink. This is the whole "premium" trick. */}
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor={GOLD_MID} />
            <stop offset="45%"  stopColor={GOLD_INK} />
            <stop offset="100%" stopColor={GOLD_DEEP} />
          </linearGradient>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {type === 'murukku' && <MurukkuArt gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'laddu'   && <LadduArt   gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'thattai' && <ThattaiArt gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'jangiri' && <JangiriArt gradId={gradId} glowId={glowId} delay={delay} />}
      </svg>
    </div>
  )
}

// ═══════════════ Individual snack illustrations ═══════════════

/** Murukku — 8-lobed rose curve (outer silhouette) + inner 2-turn spiral.
 *  The two-layer draw sells the "twisted knot" feel of a real murukku
 *  without needing to trace an actual interlocking path. */
function MurukkuArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  const outerPath = useMemo(() => {
    // r(θ) = 60 + 18·cos(8θ) — 8 gentle bumps around a circle
    const steps = 400
    const parts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2
      const r = 60 + 18 * Math.cos(8 * t)
      const x = 100 + r * Math.cos(t)
      const y = 100 + r * Math.sin(t)
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return parts.join(' ') + ' Z'
  }, [])

  const spiralPath = useMemo(() => {
    // Archimedean spiral inside the outer silhouette
    const steps = 200
    const parts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 4
      const r = 6 + t * 4.5
      const x = 100 + r * Math.cos(t)
      const y = 100 + r * Math.sin(t)
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return parts.join(' ')
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      <motion.path
        d={outerPath}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 3.5, delay, ease: 'easeInOut' }}
      />
      <motion.path
        d={spiralPath}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={2.5}
        strokeLinecap="round"
        initial={reduce ? { pathLength: 1, opacity: 0.75 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.8 }}
        transition={{ duration: 2, delay: delay + 1.5, ease: 'easeInOut' }}
      />
    </g>
  )
}

/** Boondi laddu — outer ring drawn first, then 30 texture bits fade in
 *  (representing the boondi drops), then 2 highlight arcs suggest the
 *  laddu's spherical shape catching light. */
function LadduArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  // Boondi texture dots — polar-random within the outer radius, seeded
  // once at mount so they don't jitter on re-render.
  const dots = useMemo(() => {
    const arr: { x: number; y: number; r: number }[] = []
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * 50   // sqrt for even area distribution
      arr.push({
        x: 100 + r * Math.cos(angle),
        y: 100 + r * Math.sin(angle),
        r: 2 + Math.random() * 2.5,
      })
    }
    return arr
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      {/* Outer laddu circle */}
      <motion.circle
        cx={100}
        cy={100}
        r={60}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        initial={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2.2, delay, ease: 'easeInOut' }}
      />
      {/* Boondi texture — pop in one after another */}
      {dots.map((d, i) => (
        <motion.circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={GOLD_DEEP}
          initial={reduce ? { opacity: 0.7, scale: 1 } : { opacity: 0, scale: 0 }}
          animate={{ opacity: 0.75, scale: 1 }}
          transition={{ duration: 0.4, delay: delay + 1.5 + i * 0.035, ease: 'backOut' }}
        />
      ))}
      {/* Two highlight arcs — suggest the sphere catching light. */}
      <motion.path
        d="M 62 82 A 45 45 0 0 1 90 60"
        fill="none"
        stroke={GOLD_MID}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.65}
        initial={reduce ? { pathLength: 1, opacity: 0.65 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.65 }}
        transition={{ duration: 1, delay: delay + 3, ease: 'easeOut' }}
      />
      <motion.path
        d="M 68 68 A 40 40 0 0 1 80 60"
        fill="none"
        stroke={GOLD_MID}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.5}
        initial={reduce ? { pathLength: 1, opacity: 0.5 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.5 }}
        transition={{ duration: 0.8, delay: delay + 3.3, ease: 'easeOut' }}
      />
    </g>
  )
}

/** Thattai — flat crisp. Outer circle, 8 radial score marks (the notches
 *  that keep it from puffing while frying), centre indent circle, and a
 *  scatter of perforation dots. */
function ThattaiArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  const scoreMarks = useMemo(() => {
    const arr: { x1: number; y1: number; x2: number; y2: number }[] = []
    const count = 8
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.PI / 16
      const innerR = 18
      const outerR = 48
      arr.push({
        x1: 100 + innerR * Math.cos(angle),
        y1: 100 + innerR * Math.sin(angle),
        x2: 100 + outerR * Math.cos(angle),
        y2: 100 + outerR * Math.sin(angle),
      })
    }
    return arr
  }, [])

  const perforations = useMemo(() => {
    const arr: { x: number; y: number; r: number }[] = []
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 15 + Math.sqrt(Math.random()) * 35
      arr.push({
        x: 100 + r * Math.cos(angle),
        y: 100 + r * Math.sin(angle),
        r: 1.2 + Math.random() * 1.3,
      })
    }
    return arr
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      {/* Outer ring */}
      <motion.circle
        cx={100}
        cy={100}
        r={60}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        initial={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2, delay, ease: 'easeInOut' }}
      />
      {/* Radial score marks */}
      {scoreMarks.map((m, i) => (
        <motion.line
          key={i}
          x1={m.x1}
          y1={m.y1}
          x2={m.x2}
          y2={m.y2}
          stroke={`url(#${gradId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={reduce ? { pathLength: 1, opacity: 0.85 } : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.85 }}
          transition={{ duration: 0.9, delay: delay + 1.5 + i * 0.09, ease: 'easeOut' }}
        />
      ))}
      {/* Inner centre indent */}
      <motion.circle
        cx={100}
        cy={100}
        r={12}
        fill="none"
        stroke={GOLD_DEEP}
        strokeWidth={2}
        initial={reduce ? { pathLength: 1, opacity: 0.8 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.8 }}
        transition={{ duration: 0.8, delay: delay + 2.5, ease: 'easeOut' }}
      />
      {/* Perforation texture dots */}
      {perforations.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.r}
          fill={GOLD_DEEP}
          initial={reduce ? { opacity: 0.65, scale: 1 } : { opacity: 0, scale: 0 }}
          animate={{ opacity: 0.7, scale: 1 }}
          transition={{ duration: 0.35, delay: delay + 2.8 + i * 0.04, ease: 'backOut' }}
        />
      ))}
    </g>
  )
}

/** Jangiri — 6 interlocking rings around a centre point, the classic
 *  "flower of Os" silhouette. Each ring draws in sequence, then a small
 *  centre dot appears. */
function JangiriArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  const rings = useMemo(() => {
    const arr: { cx: number; cy: number; r: number }[] = []
    const petals = 6
    const orbitR = 28
    const ringR  = 25
    for (let i = 0; i < petals; i++) {
      const angle = (i / petals) * Math.PI * 2 + Math.PI / 12
      arr.push({
        cx: 100 + orbitR * Math.cos(angle),
        cy: 100 + orbitR * Math.sin(angle),
        r: ringR,
      })
    }
    return arr
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      {rings.map((ring, i) => (
        <motion.circle
          key={i}
          cx={ring.cx}
          cy={ring.cy}
          r={ring.r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={3.5}
          initial={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.9 }}
          transition={{ duration: 1.6, delay: delay + i * 0.25, ease: 'easeInOut' }}
        />
      ))}
      {/* Central dot */}
      <motion.circle
        cx={100}
        cy={100}
        r={5}
        fill={GOLD_DEEP}
        initial={reduce ? { opacity: 0.85, scale: 1 } : { opacity: 0, scale: 0 }}
        animate={{ opacity: 0.85, scale: 1 }}
        transition={{ duration: 0.5, delay: delay + 2.5, ease: [0.34, 1.56, 0.64, 1] }}
      />
    </g>
  )
}

// ═══════════════ Gold dust motes ═══════════════

/** ~24 warm-brass specks drifting slowly. Kept from the kolam version —
 *  a small amount of dust particle motion prevents the finished snacks
 *  from feeling static after the initial reveal. */
function GoldDust() {
  const reduce = useReducedMotion()
  const particles = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 1.5 + Math.random() * 2,
        driftX: (Math.random() - 0.5) * 50,
        driftY: -18 - Math.random() * 30,
        duration: 14 + Math.random() * 10,
        delay: Math.random() * 6,
      })),
    [],
  )

  if (reduce) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        {particles.map((p) => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: GOLD_INK,
              opacity: 0.35,
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: GOLD_INK,
            willChange: 'transform, opacity',
          }}
          animate={{
            x: [0, p.driftX, 0],
            y: [0, p.driftY, 0],
            opacity: [0.15, 0.5, 0.15],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

// ═══════════════ Shared types ═══════════════

type SnackArtProps = {
  gradId: string
  glowId: string
  delay: number
}
