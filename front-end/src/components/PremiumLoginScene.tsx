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

type SnackType =
  | 'murukku'
  | 'laddu'
  | 'thattai'
  | 'jangiri'
  | 'kai_murukku'
  | 'ribbon'
  | 'kaju_katli'
  | 'mixture'
  // Ingredient silhouettes — extends the "gold silhouette" language to the
  // raw materials, adding narrative depth (finished snacks + ingredients).
  | 'cashew'
  | 'cardamom'
  | 'chilli'
  | 'coconut'
type SnackPos  = { type: SnackType; left: string; top: string; size: number; delay: number }

// Placements — % of viewport, translated -50%/-50% so `left/top` point at
// the CENTRE of each snack (not its top-left corner). Two tiers:
//   • Primary (~210-240px) in the four corners — the anchor cast.
//   • Accent (~140-150px) in the mid-top and mid-bottom strips — the
//     supporting cast, half-size so they read as secondary.
// All placements deliberately avoid the ~35-65% × ~22-78% centre where
// the login card sits.
// Delays are interleaved (0.4 / 0.9 / 1.4 / 1.9 / 2.4 / 2.9 / 3.4 / 3.9)
// so the reveal alternates between a primary and an accent — keeps the
// cadence rhythmic rather than "all big first, then all small."
const SNACK_POSITIONS: SnackPos[] = [
  // ── Primary corner cast ──
  { type: 'murukku',     left: '12%', top: '18%', size: 240, delay: 0.4 },
  { type: 'laddu',       left: '86%', top: '16%', size: 210, delay: 1.4 },
  { type: 'thattai',     left: '11%', top: '78%', size: 220, delay: 2.4 },
  { type: 'jangiri',     left: '88%', top: '75%', size: 220, delay: 3.4 },
  // ── Accent supporting cast (smaller, non-circular variety) ──
  { type: 'kai_murukku', left: '30%', top: '8%',  size: 140, delay: 0.9 },
  { type: 'ribbon',      left: '70%', top: '8%',  size: 150, delay: 1.9 },
  { type: 'kaju_katli',  left: '32%', top: '92%', size: 140, delay: 2.9 },
  { type: 'mixture',     left: '68%', top: '92%', size: 140, delay: 3.9 },
  // ── Ingredient scatter (mid-vertical edges, smaller still ~100-110px) ──
  // Fills the empty mid-strips on the left + right edges without touching
  // the login card zone (which sits roughly at 35-65% × 22-78%).
  { type: 'cashew',      left: '4%',  top: '42%', size: 110, delay: 4.4 },
  { type: 'cardamom',    left: '96%', top: '42%', size: 100, delay: 4.9 },
  { type: 'chilli',      left: '4%',  top: '58%', size: 110, delay: 5.4 },
  { type: 'coconut',     left: '96%', top: '58%', size: 110, delay: 5.9 },
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
      {/* ── Layer stack, back to front ──
          Watermark is deepest so brand identity sits behind everything.
          Kolam frame sits above it but below active elements. Sesame &
          steam are atmospheric mid-layers. Snacks + dust are the hero
          content. Temple borders render LAST so they always frame the
          scene — nothing paints over them. */}
      <TamilWatermark />
      <KolamCardFrame />
      <SesameRain />
      <SteamWisps />
      {SNACK_POSITIONS.map((pos, i) => (
        <SnackFrame key={i} {...pos} />
      ))}
      <GoldDust />
      <TempleBorder position="top" />
      <TempleBorder position="bottom" />
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
        {type === 'murukku'     && <MurukkuArt     gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'laddu'       && <LadduArt       gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'thattai'     && <ThattaiArt     gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'jangiri'     && <JangiriArt     gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'kai_murukku' && <KaiMurukkuArt  gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'ribbon'      && <RibbonPakodaArt gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'kaju_katli'  && <KajuKatliArt   gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'mixture'     && <MixtureArt     gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'cashew'      && <CashewArt      gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'cardamom'    && <CardamomArt    gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'chilli'      && <ChilliArt      gradId={gradId} glowId={glowId} delay={delay} />}
        {type === 'coconut'     && <CoconutArt     gradId={gradId} glowId={glowId} delay={delay} />}
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

/** Kai murukku — smaller "hand-piped" murukku with more petals (10 vs 8)
 *  and a tighter inner spiral (1.5 turns vs 2). Reads as a smaller-scale
 *  variety-pack sibling to the corner murukku. */
function KaiMurukkuArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  const outerPath = useMemo(() => {
    const steps = 400
    const parts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2
      const r = 55 + 14 * Math.cos(10 * t)      // 10 petals — curlier feel
      const x = 100 + r * Math.cos(t)
      const y = 100 + r * Math.sin(t)
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return parts.join(' ') + ' Z'
  }, [])

  const spiralPath = useMemo(() => {
    const steps = 150
    const parts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 3       // 1.5 turns
      const r = 4 + t * 5
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
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.9 }}
        transition={{ duration: 2.5, delay, ease: 'easeInOut' }}
      />
      <motion.path
        d={spiralPath}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={2}
        strokeLinecap="round"
        initial={reduce ? { pathLength: 1, opacity: 0.75 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.78 }}
        transition={{ duration: 1.4, delay: delay + 1.2, ease: 'easeInOut' }}
      />
    </g>
  )
}

/** Ribbon pakoda — three parallel wavy strips, each with a different
 *  wave frequency + phase so they never crest at the same x. Reads as
 *  fried ribbon strips stacked together. First non-circular form in the
 *  set — deliberately different silhouette from the four corners. */
function RibbonPakodaArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  const ribbons = useMemo(() => {
    const configs = [
      { yBase: 72,  amp: 22, freq: 3.0, phase: 0.0 },
      { yBase: 100, amp: 26, freq: 3.5, phase: 0.8 },
      { yBase: 128, amp: 22, freq: 3.0, phase: 1.6 },
    ]
    return configs.map((c) => {
      const steps = 100
      const parts: string[] = []
      for (let i = 0; i <= steps; i++) {
        const x = 25 + (i / steps) * 150
        const t = (i / steps) * Math.PI * 2 * c.freq + c.phase
        const y = c.yBase + c.amp * Math.sin(t)
        parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      }
      return parts.join(' ')
    })
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      {ribbons.map((path, i) => (
        <motion.path
          key={i}
          d={path}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? { pathLength: 1, opacity: 0.88 } : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.88 }}
          transition={{ duration: 2, delay: delay + i * 0.35, ease: 'easeInOut' }}
        />
      ))}
    </g>
  )
}

/** Kaju katli — cashew diamond with an inner concentric outline plus a
 *  scatter of silver-leaf shimmer dots. The rhombus is the first angular
 *  silhouette in the set (all others are radial), which is the whole
 *  reason it's here — breaks the circle repetition. */
function KajuKatliArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  // Silver-leaf dots — polar-random inside the rhombus. Manhattan-metric
  // rejection sampling keeps them within the diamond boundary.
  const dots = useMemo(() => {
    const arr: { x: number; y: number; r: number }[] = []
    let attempts = 0
    while (arr.length < 14 && attempts < 120) {
      attempts++
      const x = 55 + Math.random() * 90
      const y = 55 + Math.random() * 90
      if (Math.abs(x - 100) + Math.abs(y - 100) < 38) {
        arr.push({ x, y, r: 1.4 + Math.random() * 1.4 })
      }
    }
    return arr
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      {/* Outer rhombus */}
      <motion.path
        d="M 100 30 L 170 100 L 100 170 L 30 100 Z"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.92 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2, delay, ease: 'easeInOut' }}
      />
      {/* Inner concentric rhombus — echoes the outer edge, gives depth */}
      <motion.path
        d="M 100 55 L 145 100 L 100 145 L 55 100 Z"
        fill="none"
        stroke={GOLD_DEEP}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.7 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.7 }}
        transition={{ duration: 1.4, delay: delay + 1.2, ease: 'easeInOut' }}
      />
      {/* Silver-leaf shimmer dots */}
      {dots.map((d, i) => (
        <motion.circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={GOLD_MID}
          initial={reduce ? { opacity: 0.7, scale: 1 } : { opacity: 0, scale: 0 }}
          animate={{ opacity: 0.7, scale: 1 }}
          transition={{ duration: 0.4, delay: delay + 2 + i * 0.05, ease: 'backOut' }}
        />
      ))}
    </g>
  )
}

/** Mixture — cluster of ~22 small dashes at random positions and
 *  orientations, densely packed to read as a heap of savoury bits.
 *  First irregular form in the set (no dominant outline). Each dash
 *  strokes in over 500ms with a 60ms stagger, so the pile assembles
 *  itself rather than appearing all at once. */
function MixtureArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  const dashes = useMemo(() => {
    const arr: { x1: number; y1: number; x2: number; y2: number }[] = []
    for (let i = 0; i < 22; i++) {
      const rAngle    = Math.random() * Math.PI * 2
      const rDist     = Math.sqrt(Math.random()) * 52   // sqrt = even area
      const cx        = 100 + rDist * Math.cos(rAngle)
      const cy        = 100 + rDist * Math.sin(rAngle)
      const dashAngle = Math.random() * Math.PI * 2
      const dashLen   = 8 + Math.random() * 8
      const hx        = (dashLen / 2) * Math.cos(dashAngle)
      const hy        = (dashLen / 2) * Math.sin(dashAngle)
      arr.push({ x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy })
    }
    return arr
  }, [])

  return (
    <g filter={`url(#${glowId})`}>
      {dashes.map((d, i) => (
        <motion.line
          key={i}
          x1={d.x1}
          y1={d.y1}
          x2={d.x2}
          y2={d.y2}
          stroke={`url(#${gradId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={reduce ? { pathLength: 1, opacity: 0.85 } : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.85 }}
          transition={{ duration: 0.5, delay: delay + i * 0.06, ease: 'easeOut' }}
        />
      ))}
    </g>
  )
}

// ═══════════════ Ingredient silhouettes (raw materials) ═══════════════

/** Cashew — kidney/crescent bean shape. Outer arc bulges up, inner curve
 *  dips in, closing to form the classic cashew profile. Same gradient
 *  stroke as the finished snacks so it reads as part of the same
 *  visual family. */
function CashewArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  return (
    <g filter={`url(#${glowId})`}>
      <motion.path
        d="M 40 100
           C 40 40, 160 40, 160 100
           C 155 118, 130 128, 100 118
           C 70 128, 45 118, 40 100 Z"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.92 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2.2, delay, ease: 'easeInOut' }}
      />
      {/* Subtle inner highlight arc — suggests the curve of the cashew
          catching light on its convex top. */}
      <motion.path
        d="M 60 85 Q 100 55, 140 85"
        fill="none"
        stroke={GOLD_MID}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.55}
        initial={reduce ? { pathLength: 1, opacity: 0.55 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.55 }}
        transition={{ duration: 1, delay: delay + 1.4, ease: 'easeOut' }}
      />
    </g>
  )
}

/** Cardamom pod — elongated oval with 3 vertical scoring lines
 *  suggesting the ridged pod exterior. Small stem cap at top. */
function CardamomArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  return (
    <g filter={`url(#${glowId})`}>
      {/* Pod outline — narrow tall ellipse */}
      <motion.ellipse
        cx={100}
        cy={100}
        rx={30}
        ry={55}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={3.5}
        initial={reduce ? { pathLength: 1, opacity: 0.92 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2, delay, ease: 'easeInOut' }}
      />
      {/* Three vertical scoring lines — the pod's ridges */}
      {[85, 100, 115].map((x, i) => (
        <motion.line
          key={i}
          x1={x}
          y1={55}
          x2={x}
          y2={145}
          stroke={GOLD_DEEP}
          strokeWidth={1.6}
          strokeLinecap="round"
          opacity={0.7}
          initial={reduce ? { pathLength: 1, opacity: 0.7 } : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.7 }}
          transition={{ duration: 1.2, delay: delay + 1.4 + i * 0.15, ease: 'easeOut' }}
        />
      ))}
      {/* Stem cap — small triangle at top */}
      <motion.path
        d="M 92 47 L 100 38 L 108 47"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.9 }}
        transition={{ duration: 0.7, delay: delay + 2, ease: 'easeOut' }}
      />
    </g>
  )
}

/** Chilli — long curved teardrop with a small stem+leaf at the top.
 *  Slight left-leaning curve makes it feel hand-picked rather than
 *  bilaterally symmetric. */
function ChilliArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  return (
    <g filter={`url(#${glowId})`}>
      {/* Chilli body — closed teardrop path */}
      <motion.path
        d="M 100 40
           Q 118 45, 122 75
           Q 128 115, 115 150
           Q 108 170, 100 172
           Q 92 170, 88 150
           Q 78 115, 82 75
           Q 87 45, 100 40 Z"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.92 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2.4, delay, ease: 'easeInOut' }}
      />
      {/* Stem + calyx — small V at the top */}
      <motion.path
        d="M 90 42 Q 95 28, 100 30 Q 105 28, 110 42"
        fill="none"
        stroke={GOLD_DEEP}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1, opacity: 0.85 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ duration: 1, delay: delay + 1.6, ease: 'easeOut' }}
      />
      {/* Inner highlight — subtle curve down the body to suggest the
          seam / gloss on the chilli's skin. */}
      <motion.path
        d="M 100 55 Q 103 100, 100 155"
        fill="none"
        stroke={GOLD_MID}
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={0.5}
        initial={reduce ? { pathLength: 1, opacity: 0.5 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.5 }}
        transition={{ duration: 1.6, delay: delay + 2, ease: 'easeOut' }}
      />
    </g>
  )
}

/** Coconut — oval body with 3 small "eyes" at the top (the classic
 *  coconut identification marks) and two subtle fibre-texture arcs. */
function CoconutArt({ gradId, glowId, delay }: SnackArtProps) {
  const reduce = useReducedMotion()

  return (
    <g filter={`url(#${glowId})`}>
      {/* Body — slightly taller than wide, coconut-oval */}
      <motion.ellipse
        cx={100}
        cy={105}
        rx={52}
        ry={58}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={4}
        initial={reduce ? { pathLength: 1, opacity: 0.92 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.92 }}
        transition={{ duration: 2.2, delay, ease: 'easeInOut' }}
      />
      {/* Three "eyes" at the top — the classic coconut identification */}
      {[
        { cx: 88, cy: 70, r: 4 },
        { cx: 100, cy: 62, r: 4.5 },
        { cx: 112, cy: 70, r: 4 },
      ].map((e, i) => (
        <motion.circle
          key={i}
          cx={e.cx}
          cy={e.cy}
          r={e.r}
          fill={GOLD_DEEP}
          initial={reduce ? { opacity: 0.85, scale: 1 } : { opacity: 0, scale: 0 }}
          animate={{ opacity: 0.85, scale: 1 }}
          transition={{ duration: 0.5, delay: delay + 1.5 + i * 0.15, ease: 'backOut' }}
        />
      ))}
      {/* Fibre-texture arcs — two curves at the sides suggesting the
          coconut's fibrous outer husk. */}
      <motion.path
        d="M 55 95 Q 62 105, 70 100"
        fill="none"
        stroke={GOLD_MID}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.55}
        initial={reduce ? { pathLength: 1, opacity: 0.55 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.55 }}
        transition={{ duration: 0.8, delay: delay + 2.2, ease: 'easeOut' }}
      />
      <motion.path
        d="M 130 100 Q 138 105, 145 95"
        fill="none"
        stroke={GOLD_MID}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.55}
        initial={reduce ? { pathLength: 1, opacity: 0.55 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.55 }}
        transition={{ duration: 0.8, delay: delay + 2.4, ease: 'easeOut' }}
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

// ═══════════════ Atmosphere & framing layers ═══════════════

/** Temple border — traditional South Indian ornamental strip along the
 *  top or bottom edge of the viewport. Two parallel gold lines with
 *  alternating diamond + circle motifs between them, repeating across
 *  the full width via SVG `<pattern>`. */
function TempleBorder({ position }: { position: 'top' | 'bottom' }) {
  const patternId = `temple-pat-${position}`
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [position]: 0,
        height: 32,
        pointerEvents: 'none',
      }}
    >
      <svg
        width="100%"
        height="32"
        viewBox="0 0 400 32"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <defs>
          <pattern
            id={patternId}
            x="0"
            y="0"
            width="40"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            {/* Two parallel horizontal lines — the "rails" the ornaments
                sit between */}
            <line x1="0" y1="10" x2="40" y2="10" stroke={GOLD_DEEP} strokeWidth={0.8} opacity={0.85} />
            <line x1="0" y1="22" x2="40" y2="22" stroke={GOLD_DEEP} strokeWidth={0.8} opacity={0.85} />
            {/* Diamond at x=10 — filled, gold-ink */}
            <path d="M 10 12 L 13 16 L 10 20 L 7 16 Z" fill={GOLD_INK} opacity={0.85} />
            {/* Circle at x=30 — hollow, gold-deep */}
            <circle cx="30" cy="16" r="2" fill="none" stroke={GOLD_DEEP} strokeWidth={0.9} opacity={0.9} />
          </pattern>
        </defs>
        <rect width="400" height="32" fill={`url(#${patternId})`} />
      </svg>
    </div>
  )
}

/** Tamil watermark — "கோவில்பட்டி" set huge and rotated across the
 *  viewport at very low opacity. Adds cultural identity without competing
 *  with the login card. Font stack falls back through Latha (Windows) /
 *  Tamil MN (macOS) / system defaults so it renders on almost any device. */
function TamilWatermark() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          // Common Tamil-script fallback chain. Latha = Windows,
          // "Tamil MN" = macOS, "Noto Sans Tamil" = Android/Linux.
          fontFamily:
            '"Noto Sans Tamil", "Latha", "Tamil MN", "InaiMathi", system-ui, sans-serif',
          // Scales up with viewport so it always feels grand.
          fontSize: 'clamp(140px, 20vw, 300px)',
          fontWeight: 700,
          color: GOLD_INK,
          opacity: 0.07,
          transform: 'rotate(-6deg)',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
          userSelect: 'none',
        }}
      >
        கோவில்பட்டி
      </div>
    </div>
  )
}

/** Kolam card frame — subtle 12-petal rose curve drawn behind where the
 *  login card sits. Very low opacity so it reads as an ambient frame
 *  rather than a hero pattern. Slow rotation for gentle life. */
function KolamCardFrame() {
  const reduce = useReducedMotion()

  const path = useMemo(() => {
    const steps = 400
    const parts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2
      // r = 210 + 28·cos(12θ) — 12 subtle petals around a large base radius
      const r = 210 + 28 * Math.cos(12 * t)
      const x = 300 + r * Math.cos(t)
      const y = 300 + r * Math.sin(t)
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return parts.join(' ') + ' Z'
  }, [])

  return (
    <motion.div
      style={{
        position: 'absolute',
        left: '50%',
        top: '52%',                // slight offset down aligns with card
        width: 620,
        height: 620,
        translateX: '-50%',
        translateY: '-50%',
        opacity: 0.22,
      }}
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{ duration: 300, repeat: Infinity, ease: 'linear' }}
    >
      <svg viewBox="0 0 600 600" width="100%" height="100%">
        <motion.path
          d={path}
          fill="none"
          stroke={GOLD_DEEP}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 5, delay: 0.5, ease: 'easeInOut' }}
        />
        {/* Inner concentric ring — half the outer radius */}
        <motion.circle
          cx={300}
          cy={300}
          r={90}
          fill="none"
          stroke={GOLD_DEEP}
          strokeWidth={1.2}
          initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 3, delay: 3, ease: 'easeInOut' }}
        />
      </svg>
    </motion.div>
  )
}

/** Sesame rain — ~45 tiny brass specks falling continuously top-to-bottom.
 *  Each grain has an independent duration, delay, and horizontal position
 *  so the field never repeats visibly. Represents the sesame / mustard
 *  seed garnish sprinkled on freshly-made snacks. */
function SesameRain() {
  const reduce = useReducedMotion()

  const grains = useMemo(
    () =>
      Array.from({ length: 45 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 1.5 + Math.random() * 1.4,
        duration: 12 + Math.random() * 14,
        delay: Math.random() * 15,
      })),
    [],
  )

  // Reduced-motion: skip the rain entirely rather than render 45 static
  // dots (which would just look like noise). Steam + sesame are pure
  // motion effects — no motion = no reason to render them.
  if (reduce) return null

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {grains.map((g) => (
        <motion.div
          key={g.id}
          style={{
            position: 'absolute',
            left: `${g.left}%`,
            top: '-2%',
            width: g.size,
            height: g.size,
            borderRadius: '50%',
            background: GOLD_INK,
            opacity: 0.4,
            willChange: 'transform',
          }}
          animate={{ y: ['0vh', '110vh'] }}
          transition={{
            duration: g.duration,
            delay: g.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  )
}

/** Steam wisps — 4 rising vapor curls from the bottom-left and bottom-right
 *  corners. Each is a sinuous SVG curve, softly blurred, animating upward
 *  with a fade-in-then-out on a staggered infinite loop. Suggests fresh
 *  hot snacks being made just out of view. */
function SteamWisps() {
  const reduce = useReducedMotion()
  if (reduce) return null

  const wisps = [
    { left: '2%',  delay: 0,   duration: 9,  wisp: 'M 40 300 Q 25 240, 45 180 T 30 100 T 50 0' },
    { left: '10%', delay: 3,   duration: 10, wisp: 'M 40 300 Q 55 240, 35 180 T 50 100 T 30 0' },
    { left: '90%', delay: 1.5, duration: 9,  wisp: 'M 40 300 Q 55 240, 35 180 T 50 100 T 30 0' },
    { left: '96%', delay: 4.5, duration: 10, wisp: 'M 40 300 Q 25 240, 45 180 T 30 100 T 50 0' },
  ]

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {wisps.map((w, i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            left: w.left,
            bottom: 0,
            width: 80,
            height: 300,
            willChange: 'transform, opacity',
          }}
          animate={{
            y: [0, -420],
            opacity: [0, 0.3, 0.3, 0],
          }}
          transition={{
            duration: w.duration,
            delay: w.delay,
            repeat: Infinity,
            times: [0, 0.15, 0.7, 1],
            ease: 'easeOut',
          }}
        >
          <svg
            viewBox="0 0 80 300"
            width="80"
            height="300"
            style={{ overflow: 'visible', filter: 'blur(4px)' }}
          >
            <path
              d={w.wisp}
              fill="none"
              stroke="#FFF8DC"
              strokeWidth={7}
              strokeLinecap="round"
              opacity={0.45}
            />
          </svg>
        </motion.div>
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
