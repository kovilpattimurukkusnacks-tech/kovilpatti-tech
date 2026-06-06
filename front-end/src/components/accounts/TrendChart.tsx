import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import { LineChart } from '@mui/x-charts/LineChart'
import type { AccountsGrouping, AccountsTrendBucketDto } from '../../api/accounts/types'
import { formatINR } from '../../utils/format'

type Props = {
  data: AccountsTrendBucketDto[] | undefined
  loading: boolean
  grouping: AccountsGrouping
}

/**
 * Trend chart for the Accounts dashboard.
 *
 * Renders Dispatched and Returns as side-by-side bars per IST bucket, with
 * Net overlaid as a line so the eye can read both the totals and the net
 * contour at once. Empty buckets are guaranteed by the SP — no client-side
 * gap filling needed.
 *
 * Two separate charts (Bar + Line) are stacked because @mui/x-charts v9
 * doesn't yet support a mixed series of bars + lines on the same chart
 * with a clean shared x-axis (lines render fine, but the bar grouping
 * gets squeezed). The cost: ~2px of empty space between the two charts.
 */
export default function TrendChart({ data, loading, grouping }: Props) {
  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Trend ({grouping})
          </Typography>
          <Typography variant="caption" sx={{ color: '#1F1F1F99', fontWeight: 600 }}>
            Bars: Dispatched · Returns &nbsp;·&nbsp; Line: Net
          </Typography>
        </Box>

        {loading ? (
          <Skeleton variant="rectangular" height={260} />
        ) : !data || data.length === 0 ? (
          <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1F1F1F66' }}>
            No data in the selected range.
          </Box>
        ) : (
          <Box>
            <BarChart
              height={200}
              dataset={data as unknown as Record<string, number | string>[]}
              xAxis={[{ dataKey: 'bucketStart', scaleType: 'band', valueFormatter: (v: unknown) => formatBucketLabel(String(v), grouping) }]}
              yAxis={[{ valueFormatter: (v: unknown) => Number(v).toLocaleString('en-IN') }]}
              series={[
                { dataKey: 'dispatchedAmount', label: 'Dispatched', color: '#C28A00', valueFormatter: (v: number | null) => formatINR(v ?? 0) },
                { dataKey: 'returnsAmount',    label: 'Returns',    color: '#C62828', valueFormatter: (v: number | null) => formatINR(v ?? 0) },
              ]}
              margin={{ top: 8, right: 8, bottom: 4, left: 56 }}
              slotProps={{ legend: { sx: { fontSize: 12 } } }}
            />
            <LineChart
              height={130}
              dataset={data as unknown as Record<string, number | string>[]}
              xAxis={[{ dataKey: 'bucketStart', scaleType: 'band', valueFormatter: (v: unknown) => formatBucketLabel(String(v), grouping) }]}
              yAxis={[{ valueFormatter: (v: unknown) => Number(v).toLocaleString('en-IN') }]}
              series={[
                { dataKey: 'netAmount', label: 'Net', color: '#1F1F1F', curve: 'linear', showMark: true, valueFormatter: (v: number | null) => formatINR(v ?? 0) },
              ]}
              margin={{ top: 4, right: 8, bottom: 24, left: 56 }}
              slotProps={{ legend: { sx: { fontSize: 12 } } }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

/** Format the bucket-start ISO date for the x-axis tick label. The SP
 *  returns yyyy-MM-dd in IST already; just format for display. */
function formatBucketLabel(iso: string, grouping: AccountsGrouping): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (grouping === 'day')   return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  if (grouping === 'week')  return `Wk ${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
  return dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}
