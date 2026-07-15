import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import type { AccountsGrouping, AccountsTrendBucketDto } from '../../api/accounts/types'
import { formatINR } from '../../utils/format'

type Props = {
  data: AccountsTrendBucketDto[] | undefined
  loading: boolean
  grouping: AccountsGrouping
}

/**
 * All-values movement chart for the admin dashboard — every rupee figure
 * that matters, side by side per period (12-Jul-2026 client ask: "like the
 * first chart, remaining values too"):
 *
 *   🟡 Sent to shops (MRP)   🟣 Couldn't send (no stock)
 *   🔴 Came back (returns)   🔵 Purchased (cost)
 *
 * Palette validated with the dataviz six-checks script (all pass; the gold
 * contrast WARN is relieved by the always-on legend + tooltips). Sits above
 * the ProfitLossChart, sharing the same filters/buckets.
 */
export default function MovementChart({ data, loading, grouping }: Props) {
  const fmt = (v: number | null) => formatINR(v ?? 0)
  // Compact ₹ written on top of every non-zero bar (12-Jul-2026 client ask).
  const barLabel = (item: { value?: number | null }) => {
    const v = Number(item.value ?? 0)
    return v > 0 ? compactINR(v) : ''
  }
  const periodWord = grouping === 'day' ? 'each day' : grouping === 'week' ? 'each week' : 'each month'
  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Stock movement — {periodWord}
          </Typography>
          <Typography variant="caption" sx={{ color: '#1F1F1F99', fontWeight: 600 }}>
            Tap or hover a bar for the exact amount
          </Typography>
        </Box>

        {loading ? (
          <Skeleton variant="rectangular" height={300} />
        ) : !data || data.length === 0 ? (
          <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1F1F1F66' }}>
            Nothing in the selected dates.
          </Box>
        ) : (
          <BarChart
            height={300}
            dataset={data as unknown as Record<string, number | string>[]}
            borderRadius={4}
            xAxis={[{ dataKey: 'bucketStart', scaleType: 'band', valueFormatter: (v: unknown) => formatBucketLabel(String(v), grouping) }]}
            yAxis={[{ valueFormatter: (v: unknown) => Number(v).toLocaleString('en-IN') }]}
            series={[
              { dataKey: 'dispatchedAmount', label: 'Sent to shops (MRP)',      color: '#C28A00', valueFormatter: fmt, barLabel, barLabelPlacement: 'outside' },
              { dataKey: 'shortfallAmount',  label: "Couldn't send (no stock)", color: '#7B4FB6', valueFormatter: fmt, barLabel, barLabelPlacement: 'outside' },
              { dataKey: 'returnsAmount',    label: 'Came back (returns)',      color: '#C62828', valueFormatter: fmt, barLabel, barLabelPlacement: 'outside' },
              { dataKey: 'purchaseAmount',   label: 'Purchased (cost)',         color: '#1565C0', valueFormatter: fmt, barLabel, barLabelPlacement: 'outside' },
            ]}
            margin={{ top: 24, right: 8, bottom: 24, left: 64 }}
            slotProps={{ legend: { sx: { fontSize: 12 } } }}
            sx={{ '& .MuiBarLabel-root': { fontWeight: 700, fontSize: 10 } }}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** ₹56,382.50 → "₹56.4k" — short enough to sit on a bar. */
function compactINR(v: number): string {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(1)}L`
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(1)}k`
  return `₹${Math.round(v)}`
}

/** Format the bucket-start ISO date for the x-axis tick label. */
function formatBucketLabel(iso: string, grouping: AccountsGrouping): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (grouping === 'day')   return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  if (grouping === 'week')  return `Wk ${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
  return dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}
