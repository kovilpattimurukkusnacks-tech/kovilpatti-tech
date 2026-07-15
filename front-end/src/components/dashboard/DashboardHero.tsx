import { useMemo } from 'react'
import { Box, Card, CardContent, Skeleton, Tooltip, Typography } from '@mui/material'
import { SparkLineChart } from '@mui/x-charts/SparkLineChart'
import {
  ArrowDownRight, ArrowUpRight, Info,
  IndianRupee, Percent, Receipt, ShoppingCart, TrendingUp, Wallet,
} from 'lucide-react'
import type { AccountsTrendBucketDto, AccountsUtilityRowDto } from '../../api/accounts/types'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import { LOSS_RED, PROFIT_GREEN } from '../accounts/ProfitLossChart'
import { totalUtilities } from '../../hooks/useAccounts'

type Props = {
  data: AccountsTrendBucketDto[] | undefined
  utilities: AccountsUtilityRowDto[] | undefined
  loading: boolean
}

/**
 * Executive KPI hero strip. Six cards in a 3-across grid — Revenue / Gross
 * Profit / Net Profit / Purchased Cost / Utilities / Gross Margin. Net
 * Profit is the "hero" tile (gold gradient) because it's the client's
 * actual question — "how much did I keep after every bill".
 *
 * Row 1 tells the story left-to-right: Revenue → Gross Profit → Net Profit
 * (the answer). Row 2 shows the components: Cost / Utilities / Margin %.
 *
 * Utilities logic: shop_utility_expenses.amount summed across the
 * (from, to, shopIds) filter. Counted by expense_date only — see the
 * tooltip on the Utilities card.
 *
 * Sparklines are wired only for the four trend-backed metrics (Revenue,
 * Cost, Gross Profit, Margin). Utilities have no per-bucket series (they
 * are logged as monthly bulk entries, so a day-bucketed sparkline would
 * be misleading), and Net Profit is left without a sparkline for the same
 * reason — its shape would inherit Gross Profit's, which the user can see
 * on the neighbouring card.
 */
export default function DashboardHero({ data, utilities, loading }: Props) {
  const totals = useMemo(() => computeTotals(data, utilities), [data, utilities])
  const sparks = useMemo(() => computeSparks(data), [data])

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
        gap: 2,
      }}
    >
      {/* Row 1 — the "top-line story": Revenue → Gross Profit → Net Profit. */}
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
        label={totals.gross >= 0 ? 'Gross Profit' : 'Gross Loss'}
        value={Math.abs(totals.gross)}
        loading={loading}
        icon={<TrendingUp size={16} />}
        sparkData={sparks.gross}
        sparkColor={totals.gross >= 0 ? PROFIT_GREEN : LOSS_RED}
        delta={totals.grossDelta}
        heroTone={totals.gross >= 0 ? 'profit' : 'loss'}
      />
      <KpiCard
        label={totals.net >= 0 ? 'Net Profit' : 'Net Loss'}
        value={Math.abs(totals.net)}
        loading={loading}
        icon={<Wallet size={16} />}
        sparkColor={totals.net >= 0 ? PROFIT_GREEN : LOSS_RED}
        accent="hero"
        heroTone={totals.net >= 0 ? 'profit' : 'loss'}
        tooltip="Net Profit = Gross Profit − Utilities logged in this date range."
      />

      {/* Row 2 — the components: Cost, Utilities, Margin. */}
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
        label="Utilities"
        value={totals.utilities}
        loading={loading}
        icon={<Receipt size={16} />}
        sparkColor="#B45309"
        tooltip="Total shop utility expenses (Rent, Electricity, Salary, …) logged in this date range. Counted by expense_date only — monthly bills logged as a single entry may under-count a partial-month view."
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
  accent = 'plain', heroTone = 'profit', deltaTone = 'normal', tooltip,
}: {
  label: string
  value: number
  loading: boolean
  icon: React.ReactNode
  /** Omit for cards with no per-bucket trend (Utilities, Net Profit). */
  sparkData?: number[]
  sparkColor: string
  delta?: DeltaSignal
  valueFormat?: 'rupees' | 'percent'
  /** 'hero' = gold gradient / thicker frame (the anchor tile). */
  accent?: 'plain' | 'hero'
  /** For the hero tile only — flips to red styling on a net loss. */
  heroTone?: 'profit' | 'loss'
  /** 'cost' inverts the delta colour so "up = bad, down = good". */
  deltaTone?: 'normal' | 'cost'
  /** Optional info tooltip — anchors on an info glyph next to the label. */
  tooltip?: string
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 10 }}
            >
              {label}
            </Typography>
            {tooltip && (
              <Tooltip title={tooltip} arrow enterDelay={200}>
                {/* span wrapper so Tooltip's ref doesn't collide with the SVG icon. */}
                <Box component="span" sx={{ display: 'inline-flex', color: '#1F1F1F80', cursor: 'help' }}>
                  <Info size={12} />
                </Box>
              </Tooltip>
            )}
          </Box>
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
              // Tabular numerals — digits align across the cards.
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

        {/* Sparkline — inline mini-chart. Cards without per-bucket data
            (utilities / net profit) render a matching-height spacer so
            heights across all six cards stay uniform. */}
        {loading ? null : sparkData && sparkData.length > 1 ? (
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
        ) : (
          <Box sx={{ mt: 0.5, height: 34 }} />
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
 *
 * Utilities do NOT have a per-bucket series (they're one-off entries on
 * shop_utility_expenses.expense_date), so they only contribute to the
 * scalar totals — no first-half / second-half delta. Net Profit inherits
 * the Gross delta (utilities treated as flat within the range).
 */
function computeTotals(
  data: AccountsTrendBucketDto[] | undefined,
  utilities: AccountsUtilityRowDto[] | undefined,
) {
  const rows = data ?? []
  const revenue   = rows.reduce((s, r) => s + r.netAmount,      0)
  const cost      = rows.reduce((s, r) => s + r.purchaseAmount, 0)
  const gross     = revenue - cost
  const util      = totalUtilities(utilities)
  const net       = gross - util
  const marginPct = revenue > 0 ? (gross / revenue) * 100 : 0

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
  const groA = revA - cosA
  const groB = revB - cosB

  const delta = (base: number, curr: number): DeltaSignal => ({
    pct: base > 0 ? ((curr - base) / base) * 100 : 0,
    isPositive: curr >= base,
    meaningful: base > 0 && rows.length >= 4,
  })

  return {
    revenue, cost, gross, utilities: util, net, marginPct,
    revenueDelta: delta(revA, revB),
    costDelta:    delta(cosA, cosB),
    grossDelta:   delta(groA, groB),
  }
}

/**
 * Turn the trend rows into aligned sparkline series. Every card that has
 * a sparkline shares the same X-axis buckets so the eye can compare slopes.
 * Utilities + Net Profit are NOT sparklined (see the header docblock).
 */
function computeSparks(data: AccountsTrendBucketDto[] | undefined) {
  const rows = data ?? []
  return {
    revenue: rows.map(r => r.netAmount),
    cost:    rows.map(r => r.purchaseAmount),
    gross:   rows.map(r => r.netAmount - r.purchaseAmount),
    margin:  rows.map(r => r.netAmount > 0 ? ((r.netAmount - r.purchaseAmount) / r.netAmount) * 100 : 0),
  }
}
