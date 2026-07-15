import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import type { AccountsGrouping, AccountsTrendBucketDto } from '../../api/accounts/types'
import { formatINR } from '../../utils/format'

export const PROFIT_GREEN = '#2E7D32'
export const LOSS_RED = '#C62828'

type Props = {
  data: AccountsTrendBucketDto[] | undefined
  loading: boolean
  grouping: AccountsGrouping
}

/**
 * Profit / loss chart for the admin dashboard (12-Jul-2026, third redesign
 * after client feedback — "they should know profit/loss easily per day").
 *
 * One idea only: per period, profit = Net at MRP − Purchased at cost.
 *   • GREEN bar going UP   = made money that period
 *   • RED bar going DOWN   = lost money that period
 * The zero line is the floor between the two. Rupee value sits on every
 * bar, so it reads without any chart literacy at all.
 *
 * Implementation note: MUI X colours per SERIES, not per bar, so the sign
 * split is two stacked series — positive profit (green) and negative loss
 * (red) — exactly one of which is non-zero per bucket.
 */
export default function ProfitLossChart({ data, loading, grouping }: Props) {
  const periodWord = grouping === 'day' ? 'each day' : grouping === 'week' ? 'each week' : 'each month'

  const rows = (data ?? []).map(r => {
    const profit = r.netAmount - r.purchaseAmount
    return {
      bucketStart: r.bucketStart,
      profit: profit > 0 ? profit : 0,
      loss:   profit < 0 ? profit : 0,   // negative → bar drops below zero
    }
  })

  const barLabel = (item: { value?: number | null }) => {
    const v = Number(item.value ?? 0)
    return v !== 0 ? compactINR(Math.abs(v)) : ''
  }

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Profit or loss — {periodWord}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            <Box component="span" sx={{ color: PROFIT_GREEN }}>▲ Green up = profit</Box>
            {'  ·  '}
            <Box component="span" sx={{ color: LOSS_RED }}>▼ Red down = loss</Box>
          </Typography>
        </Box>

        {loading ? (
          <Skeleton variant="rectangular" height={320} />
        ) : rows.length === 0 ? (
          <Box sx={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1F1F1F66' }}>
            Nothing in the selected dates.
          </Box>
        ) : (
          <BarChart
            height={320}
            dataset={rows as unknown as Record<string, number | string>[]}
            borderRadius={4}
            xAxis={[{ dataKey: 'bucketStart', scaleType: 'band', valueFormatter: (v: unknown) => formatBucketLabel(String(v), grouping) }]}
            yAxis={[{ valueFormatter: (v: unknown) => compactINR(Number(v)) }]}
            series={[
              {
                dataKey: 'profit', stack: 'pl', label: 'Profit', color: PROFIT_GREEN,
                valueFormatter: (v: number | null) => (v ? `Profit ${formatINR(v)}` : ''),
                barLabel, barLabelPlacement: 'outside',
              },
              {
                dataKey: 'loss', stack: 'pl', label: 'Loss', color: LOSS_RED,
                valueFormatter: (v: number | null) => (v ? `Loss ${formatINR(Math.abs(v))}` : ''),
                barLabel, barLabelPlacement: 'outside',
              },
            ]}
            margin={{ top: 24, right: 8, bottom: 24, left: 64 }}
            // Single idea, named in the title + the green/red caption —
            // the in-chart legend adds nothing.
            sx={{ '& .MuiBarLabel-root': { fontWeight: 700, fontSize: 11 }, '& .MuiChartsLegend-root': { display: 'none' } }}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** ₹56,382.50 → "₹56.4k" — short enough to sit on a bar. */
function compactINR(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 10_000_000) return `${sign}₹${(a / 10_000_000).toFixed(1)}Cr`
  if (a >= 100_000)    return `${sign}₹${(a / 100_000).toFixed(1)}L`
  if (a >= 1_000)      return `${sign}₹${(a / 1_000).toFixed(1)}k`
  return `${sign}₹${Math.round(a)}`
}

/** Format the bucket-start ISO date for the x-axis tick label. */
function formatBucketLabel(iso: string, grouping: AccountsGrouping): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (grouping === 'day')   return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  if (grouping === 'week')  return `Wk ${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
  return dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}
