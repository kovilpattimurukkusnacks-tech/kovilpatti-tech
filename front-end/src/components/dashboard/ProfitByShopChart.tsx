import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import type { AccountsFilters, AccountsShopRowDto } from '../../api/accounts/types'
import { useAccountsByShop } from '../../hooks/useAccounts'
import { formatINR } from '../../utils/format'
import { LOSS_RED, PROFIT_GREEN } from '../accounts/ProfitLossChart'

type Props = {
  filters: AccountsFilters
}

/**
 * Per-shop profit bar chart for the admin dashboard. Horizontal bars,
 * sorted best → worst by profit magnitude. Green bars point right for
 * profit; red bars point left for loss. Click any bar to drill down
 * into that shop's Accounts view (matches ShopBreakdownTable's row-click
 * behaviour).
 *
 * Advanced touches:
 *   • Bars sorted by absolute profit magnitude — biggest movers on top
 *     regardless of sign, so the eye lands on what's material first.
 *   • Rupee labels sit outside each bar with sign — no legend needed.
 *   • Break-even shops (profit = 0) are elided from the chart. If a
 *     large number of shops are break-even, we show a count in the
 *     header instead of a wall of zero-length bars.
 */
export default function ProfitByShopChart({ filters }: Props) {
  const { data, isLoading, error } = useAccountsByShop(filters)

  const chart = useMemo(() => buildChartData(data), [data])

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Profit by shop
          </Typography>
          <Typography variant="caption" sx={{ color: '#1F1F1F99', fontWeight: 600 }}>
            {chart.breakEvenCount > 0
              ? `+ ${chart.breakEvenCount} break-even`
              : 'sorted by impact'}
          </Typography>
        </Box>

        {error ? (
          <Alert severity="error" sx={{ borderRadius: 2 }}>Failed to load shop breakdown.</Alert>
        ) : isLoading ? (
          <Skeleton variant="rectangular" height={360} />
        ) : chart.rows.length === 0 ? (
          <Box sx={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1F1F1F66' }}>
            No shop activity in the selected dates.
          </Box>
        ) : (
          <ProfitBars rows={chart.rows} />
        )}
      </CardContent>
    </Card>
  )
}

// ══════════════════ Chart body ══════════════════

function ProfitBars({ rows }: { rows: ProfitRow[] }) {
  const navigate = useNavigate()
  // Chart height scales with row count so 3 shops don't look like 12; capped
  // to keep a big-catalogue dashboard from becoming a scroll-monster.
  const height = Math.min(400, Math.max(180, rows.length * 34 + 40))

  // Same two-series trick as ProfitLossChart: MUI X colours per SERIES, not
  // per bar, so we split into a positive-only series (green) and a
  // negative-only series (red). Exactly one is non-zero per row.
  const dataset = rows.map(r => ({
    shopName: r.shopName,
    profit:  r.profitLoss > 0 ? r.profitLoss : 0,
    loss:    r.profitLoss < 0 ? r.profitLoss : 0,
  }))

  const barLabel = (item: { value?: number | null }) => {
    const v = Number(item.value ?? 0)
    return v !== 0 ? compactINR(Math.abs(v)) : ''
  }

  return (
    <BarChart
      layout="horizontal"
      height={height}
      dataset={dataset as unknown as Record<string, number | string>[]}
      borderRadius={4}
      // Room for long shop names on the left; a bit of right-margin so the
      // outside label doesn't get clipped for the widest positive bar.
      margin={{ top: 10, right: 44, bottom: 24, left: 140 }}
      yAxis={[{ dataKey: 'shopName', scaleType: 'band' }]}
      xAxis={[{ valueFormatter: (v: unknown) => compactINR(Number(v)) }]}
      series={[
        {
          dataKey: 'profit', stack: 'pl', label: 'Profit',
          color: PROFIT_GREEN,
          valueFormatter: (v: number | null) => v ? `Profit ${formatINR(v)}` : '',
          barLabel, barLabelPlacement: 'outside',
        },
        {
          dataKey: 'loss', stack: 'pl', label: 'Loss',
          color: LOSS_RED,
          valueFormatter: (v: number | null) => v ? `Loss ${formatINR(Math.abs(v))}` : '',
          barLabel, barLabelPlacement: 'outside',
        },
      ]}
      onItemClick={(_e, ctx) => {
        const idx = ctx?.dataIndex
        if (idx == null || idx < 0 || idx >= rows.length) return
        // Drill down: open Accounts filtered to just this shop.
        navigate(`/admin/accounts?shopIds=${rows[idx].shopId}`)
      }}
      sx={{
        '& .MuiBarLabel-root': { fontWeight: 700, fontSize: 11 },
        '& .MuiChartsLegend-root': { display: 'none' },
        '& .MuiBarElement-root': { cursor: 'pointer' },
      }}
    />
  )
}

// ══════════════════ Data pipeline ══════════════════

type ProfitRow = {
  shopId: string
  shopName: string
  profitLoss: number  // signed
}

function buildChartData(data: AccountsShopRowDto[] | undefined) {
  const raw = data ?? []
  const rows: ProfitRow[] = raw.map(r => ({
    shopId: r.shopId,
    shopName: r.shopName,
    // profit − loss = signed net (SP-side already split; either is 0).
    profitLoss: (r.profit ?? 0) - (r.loss ?? 0),
  }))
  // Sort by absolute magnitude descending — biggest movers (profit OR loss)
  // rise to the top. Then reverse for chart display so top of chart = top
  // impact (BarChart horizontal draws index 0 at the bottom).
  const nonZero = rows.filter(r => r.profitLoss !== 0)
                       .sort((a, b) => Math.abs(b.profitLoss) - Math.abs(a.profitLoss))
                       .reverse()
  const breakEvenCount = rows.length - nonZero.length
  return { rows: nonZero, breakEvenCount }
}

/** Same compact ₹ formatter used across the dashboard charts. */
function compactINR(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 10_000_000) return `${sign}₹${(a / 10_000_000).toFixed(1)}Cr`
  if (a >= 100_000)    return `${sign}₹${(a / 100_000).toFixed(1)}L`
  if (a >= 1_000)      return `${sign}₹${(a / 1_000).toFixed(1)}k`
  return `${sign}₹${Math.round(a)}`
}
