import { useMemo } from 'react'
import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { SparkLineChart } from '@mui/x-charts/SparkLineChart'
import { ArrowDownRight, ArrowUpRight, IndianRupee, Percent, ShoppingCart, TrendingUp } from 'lucide-react'
import type { AccountsTrendBucketDto } from '../../api/accounts/types'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import { LOSS_RED, PROFIT_GREEN } from '../accounts/ProfitLossChart'

type Props = {
  data: AccountsTrendBucketDto[] | undefined
  loading: boolean
}

/**
 * Executive-style KPI hero strip (12-Jul-2026, client req: "advanced &
 * professional"). Four cards side-by-side across the top of the admin
 * dashboard — Revenue, Cost, Profit (or Loss), Margin % — each with an
 * inline sparkline traced from the trend data already loaded for the
 * charts below. No extra API calls — same trend payload feeds all four
 * sparklines + all four totals.
 *
 * Visual hierarchy:
 *   • Profit card takes the gold-gradient background — the number the
 *     owner scans first. If the period is a net loss, the same card
 *     flips to a red border + red number so "the answer" is obvious.
 *   • Revenue / Cost / Margin sit in cream cards, matching the rest of
 *     the app palette. Sparklines share the axis so the eye can compare
 *     slopes even without reading exact values.
 *   • Delta labels ("↑" green / "↓" red) show first-half vs second-half
 *     of the selected range — a rough trend cue without a "vs previous
 *     period" API call.
 *
 * Positional intent: this card is the "3-second read" for the owner —
 * everything below (movement chart, per-shop bars, per-category donut)
 * is drill-down.
 */
export default function DashboardHero({ data, loading }: Props) {
  const totals = useMemo(() => computeTotals(data), [data])
  const sparks = useMemo(() => computeSparks(data), [data])

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
        gap: 2,
      }}
    >
      <KpiCard
        label="Revenue (at MRP)"
        value={totals.revenue}
        loading={loading}
        icon={<IndianRupee size={16} />}
        sparkData={sparks.revenue}
        sparkColor="#1F6FEB"
        delta={totals.revenueDelta}
      />
      <KpiCard
        label="Purchased (Cost)"
        value={totals.cost}
        loading={loading}
        icon={<ShoppingCart size={16} />}
        sparkData={sparks.cost}
        sparkColor="#8A6D3B"
        delta={totals.costDelta}
        // Cost going UP is bad — invert the delta arrow's tone.
        deltaTone="cost"
      />
      <KpiCard
        label={totals.profit >= 0 ? 'Profit' : 'Loss'}
        value={Math.abs(totals.profit)}
        loading={loading}
        icon={<TrendingUp size={16} />}
        sparkData={sparks.profit}
        sparkColor={totals.profit >= 0 ? PROFIT_GREEN : LOSS_RED}
        delta={totals.profitDelta}
        accent="hero"
        heroTone={totals.profit >= 0 ? 'profit' : 'loss'}
      />
      <KpiCard
        label="Gross Margin"
        value={totals.marginPct}
        loading={loading}
        icon={<Percent size={16} />}
        sparkData={sparks.margin}
        sparkColor={totals.marginPct >= 0 ? PROFIT_GREEN : LOSS_RED}
        // Margin is a %, not ₹ — hint the KpiCard formatter.
        valueFormat="percent"
      />
    </Box>
  )
}

// ══════════════════ Card ══════════════════

function KpiCard({
  label, value, loading, icon, sparkData, sparkColor, delta, valueFormat = 'rupees',
  accent = 'plain', heroTone = 'profit', deltaTone = 'normal',
}: {
  label: string
  value: number
  loading: boolean
  icon: React.ReactNode
  sparkData: number[]
  sparkColor: string
  delta?: DeltaSignal
  valueFormat?: 'rupees' | 'percent'
  /** 'hero' = gold gradient / thicker frame (the anchor tile). */
  accent?: 'plain' | 'hero'
  /** For the hero tile only — flips to red styling on a net loss. */
  heroTone?: 'profit' | 'loss'
  /** 'cost' inverts the delta colour so "up = bad, down = good". */
  deltaTone?: 'normal' | 'cost'
}) {
  const isHero = accent === 'hero'
  const isLossHero = isHero && heroTone === 'loss'

  return (
    <Card
      sx={{
        border: `2px solid ${isLossHero ? LOSS_RED : '#1F1F1F'}`,
        boxShadow: '4px 4px 0 0 #FCD835',
        background: isHero && !isLossHero
          ? GOLD_GRADIENT
          : isLossHero ? '#FFEBEE' : '#FFFBE6',
        color: '#1F1F1F',
        // Slight lift on the hero tile so the "answer" pulls the eye first.
        transform: isHero ? 'translateY(-2px)' : 'none',
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography
            variant="caption"
            sx={{ textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 10 }}
          >
            {label}
          </Typography>
          <Box sx={{ opacity: 0.7, display: 'flex' }}>{icon}</Box>
        </Box>

        {loading ? (
          <Skeleton variant="text" width="70%" height={40} />
        ) : (
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: isHero ? 30 : 24,
              lineHeight: 1.1,
              color: isLossHero ? LOSS_RED : '#1F1F1F',
              // Tabular numerals — digits align across the four cards.
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {valueFormat === 'percent'
              ? `${value.toFixed(1)}%`
              : formatINR(value)}
          </Typography>
        )}

        {/* Delta line — subtle enough to skip on first read, useful on second. */}
        {delta && !loading && (
          <DeltaRow delta={delta} deltaTone={deltaTone} />
        )}

        {/* Sparkline — inline mini-chart. Same 30-buckets → 30-points mapping
            across all four cards so a visual eye-cast across them reveals
            which line is diverging from the pack. */}
        {sparkData.length > 1 && !loading && (
          <Box sx={{ mt: 0.5, height: 34 }}>
            <SparkLineChart
              data={sparkData}
              height={34}
              curve="monotoneX"
              area
              color={sparkColor}
              sx={{
                '& .MuiAreaElement-root': { fillOpacity: 0.18 },
                '& .MuiLineElement-root': { strokeWidth: 2 },
              }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

// ══════════════════ Delta row ══════════════════

type DeltaSignal = {
  pct: number         // signed
  isPositive: boolean
  meaningful: boolean // false when the base period was ≤ 0 (delta is noise)
}

function DeltaRow({ delta, deltaTone }: { delta: DeltaSignal; deltaTone: 'normal' | 'cost' }) {
  if (!delta.meaningful) {
    return (
      <Typography variant="caption" sx={{ display: 'block', fontSize: 11, color: '#1F1F1F66' }}>
        vs earlier — new activity
      </Typography>
    )
  }
  // "Up is good" for revenue/profit/margin. For cost, invert — up-cost is bad.
  const goodDirection = deltaTone === 'cost' ? !delta.isPositive : delta.isPositive
  const color = goodDirection ? PROFIT_GREEN : LOSS_RED
  const Arrow = delta.isPositive ? ArrowUpRight : ArrowDownRight
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
      <Arrow size={12} color={color} />
      <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {delta.pct >= 0 ? '+' : ''}{delta.pct.toFixed(1)}%
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 11, color: '#1F1F1F66' }}>
        vs 1st half
      </Typography>
    </Box>
  )
}

// ══════════════════ Aggregations ══════════════════

/**
 * Sum every trend bucket to grand totals + estimate a within-range trend
 * signal (first-half average vs second-half average). No BE call — reads
 * the same rows already fetched for the trend charts.
 */
function computeTotals(data: AccountsTrendBucketDto[] | undefined) {
  const rows = data ?? []
  const revenue = rows.reduce((s, r) => s + r.netAmount,      0)
  const cost    = rows.reduce((s, r) => s + r.purchaseAmount, 0)
  const profit  = revenue - cost
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0

  // First-half vs second-half deltas — cheap proxy for "trending up" without
  // asking the BE for a "vs previous period" comparison. n=1 → not meaningful.
  const mid = Math.floor(rows.length / 2)
  const firstHalf  = rows.slice(0, mid)
  const secondHalf = rows.slice(mid)
  const halfSum = (arr: AccountsTrendBucketDto[], key: 'netAmount' | 'purchaseAmount') =>
    arr.reduce((s, r) => s + r[key], 0)
  const revA = halfSum(firstHalf,  'netAmount')
  const revB = halfSum(secondHalf, 'netAmount')
  const cosA = halfSum(firstHalf,  'purchaseAmount')
  const cosB = halfSum(secondHalf, 'purchaseAmount')
  const proA = revA - cosA
  const proB = revB - cosB

  const delta = (base: number, curr: number): DeltaSignal => ({
    pct: base > 0 ? ((curr - base) / base) * 100 : 0,
    isPositive: curr >= base,
    meaningful: base > 0 && rows.length >= 4,
  })

  return {
    revenue, cost, profit, marginPct,
    revenueDelta: delta(revA, revB),
    costDelta:    delta(cosA, cosB),
    profitDelta:  delta(proA, proB),
  }
}

/**
 * Turn the trend rows into 4 aligned sparkline series. Every card gets
 * the same X-axis buckets so the eye can compare slopes.
 */
function computeSparks(data: AccountsTrendBucketDto[] | undefined) {
  const rows = data ?? []
  return {
    revenue: rows.map(r => r.netAmount),
    cost:    rows.map(r => r.purchaseAmount),
    profit:  rows.map(r => r.netAmount - r.purchaseAmount),
    margin:  rows.map(r => r.netAmount > 0 ? ((r.netAmount - r.purchaseAmount) / r.netAmount) * 100 : 0),
  }
}

