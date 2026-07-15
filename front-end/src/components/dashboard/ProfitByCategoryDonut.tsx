import { useMemo } from 'react'
import { Alert, Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { PieChart } from '@mui/x-charts/PieChart'
import type { AccountsCategoryRowDto, AccountsFilters } from '../../api/accounts/types'
import { useAccountsByCategory } from '../../hooks/useAccounts'
import { formatINR } from '../../utils/format'
import { LOSS_RED, PROFIT_GREEN } from '../accounts/ProfitLossChart'

type Props = {
  filters: AccountsFilters
}

/**
 * Category profit contribution donut. Shows which category buckets are
 * driving the period's profit (or loss). Executive-view take on the
 * question "where's my money coming from?".
 *
 * Design decisions:
 *   • Only PROFITABLE categories in the donut; loss-making ones go into
 *     a compact "Losing money" strip below (a donut with negative slices
 *     doesn't make visual sense — you can't sum losses into a "whole").
 *   • Top 6 categories by profit magnitude; anything smaller collapses
 *     into an "Others" slice so the donut stays legible.
 *   • Center of donut = the period's total profit (or loss) + margin %.
 *   • Slice colour = a warm palette that avoids the profit/loss red-green
 *     signal (categories aren't good/bad on their own, they contribute).
 */
export default function ProfitByCategoryDonut({ filters }: Props) {
  const { data, isLoading, error } = useAccountsByCategory(filters)

  const model = useMemo(() => buildDonutModel(data), [data])

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', height: '100%', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Where profit comes from
          </Typography>
          <Typography variant="caption" sx={{ color: '#1F1F1F99', fontWeight: 600 }}>
            by category
          </Typography>
        </Box>

        {error ? (
          <Alert severity="error" sx={{ borderRadius: 2 }}>Failed to load category breakdown.</Alert>
        ) : isLoading ? (
          <Skeleton variant="rectangular" height={360} />
        ) : model.profitSlices.length === 0 && model.lossItems.length === 0 ? (
          <Box sx={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1F1F1F66' }}>
            No category activity in the selected dates.
          </Box>
        ) : (
          <>
            {/* Donut + centered total. When there are NO profitable
                categories (only losses), the donut collapses to a
                single "No profit yet" hint and the losing-strip below
                becomes the primary content. */}
            {model.profitSlices.length > 0 ? (
              <Box sx={{ position: 'relative' }}>
                <PieChart
                  height={280}
                  series={[
                    {
                      innerRadius: 82,
                      outerRadius: 120,
                      paddingAngle: 2,
                      cornerRadius: 4,
                      // Hide the built-in legend — we render our own below
                      // so the donut is visually balanced (label list right
                      // of the ring, not below).
                      data: model.profitSlices.map(s => ({
                        id: s.categoryId,
                        value: s.profit,
                        label: s.categoryPath,
                        color: s.color,
                      })),
                      valueFormatter: (v) => formatINR(v.value),
                    },
                  ]}
                  slotProps={{ legend: { hidden: true } as never }}
                />
                {/* Center KPI — total profit (or loss) + margin % */}
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, color: '#1F1F1F99', letterSpacing: 0.4 }}>
                    TOTAL PROFIT
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 22, fontWeight: 800, lineHeight: 1.1,
                      color: model.totalProfit >= 0 ? PROFIT_GREEN : LOSS_RED,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {model.totalProfit >= 0 ? '+' : '−'}{compactINR(Math.abs(model.totalProfit))}
                  </Typography>
                  {model.marginPct !== null && (
                    <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, color: '#1F1F1F99', mt: 0.25 }}>
                      {model.marginPct.toFixed(1)}% margin
                    </Typography>
                  )}
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  height: 200,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#1F1F1F66',
                  fontSize: 14, fontWeight: 600,
                }}
              >
                No profitable categories in this period.
              </Box>
            )}

            {/* Legend — a compact list beside/below the donut. */}
            {model.profitSlices.length > 0 && (
              <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {model.profitSlices.map(s => (
                  <Box key={s.categoryId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 10, height: 10, bgcolor: s.color, borderRadius: 0.5, flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: '#1F1F1F',
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.categoryPath}
                    </Box>
                    <Box sx={{ fontSize: 12, fontWeight: 700, color: PROFIT_GREEN, fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(s.profit)}
                    </Box>
                    <Box sx={{ fontSize: 11, fontWeight: 600, color: '#1F1F1F66', minWidth: 42, textAlign: 'right' }}>
                      {(s.share * 100).toFixed(0)}%
                    </Box>
                  </Box>
                ))}
              </Box>
            )}

            {/* Loss-making categories — separate strip below the donut. */}
            {model.lossItems.length > 0 && (
              <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px dashed rgba(31,31,31,0.2)' }}>
                <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, color: LOSS_RED, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  Losing money
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, mt: 0.5 }}>
                  {model.lossItems.map(l => (
                    <Box key={l.categoryId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0, fontSize: 12, color: '#1F1F1F',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.categoryPath}
                      </Box>
                      <Box sx={{ fontSize: 12, fontWeight: 700, color: LOSS_RED, fontVariantNumeric: 'tabular-nums' }}>
                        −{formatINR(l.loss)}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ══════════════════ Data pipeline ══════════════════

type ProfitSlice = {
  categoryId:   number | string
  categoryPath: string
  profit:       number
  share:        number  // fraction of total profit contributed by this slice
  color:        string
}

type LossItem = {
  categoryId:   number
  categoryPath: string
  loss:         number
}

// Warm categorical palette — deliberately neutral (no green/red) so the
// donut colours don't compete with the P&L signal on the KPI strip above.
// 8 hues; 9th+ collapse into 'Others'.
const DONUT_COLORS = [
  '#C28A00', // amber (matches app accent)
  '#7C4A00', // deep amber-brown
  '#0277BD', // ocean blue
  '#00838F', // teal
  '#5E35B1', // deep purple
  '#D84315', // burnt orange
  '#37474F', // slate
  '#9E9D24', // olive
]
const OTHERS_COLOR = '#8D6E63' // muted brown for the residual

const TOP_N = 6

function buildDonutModel(data: AccountsCategoryRowDto[] | undefined) {
  const rows = data ?? []

  // Split profitable vs loss-making. A category can only be one or the
  // other per period — SP guarantees profit / loss are mutually exclusive.
  const profitable = rows.filter(r => (r.profit ?? 0) > 0)
                         .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
  const losing     = rows.filter(r => (r.loss ?? 0) > 0)
                         .sort((a, b) => (b.loss ?? 0) - (a.loss ?? 0))

  // Sum revenue-side to derive margin %; falls back to null if 0 (avoid
  // divide-by-zero showing "Infinity %").
  const totalRevenue = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const totalProfit  = rows.reduce((s, r) => s + (r.profit ?? 0) - (r.loss ?? 0), 0)
  const marginPct    = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : null

  // Top-N + Others aggregation for the donut.
  const totalProfitPool = profitable.reduce((s, r) => s + r.profit, 0)
  const head = profitable.slice(0, TOP_N)
  const tail = profitable.slice(TOP_N)
  const tailSum = tail.reduce((s, r) => s + r.profit, 0)

  const profitSlices: ProfitSlice[] = head.map((r, i) => ({
    categoryId:   r.categoryId,
    categoryPath: r.categoryPath,
    profit:       r.profit,
    share:        totalProfitPool > 0 ? r.profit / totalProfitPool : 0,
    color:        DONUT_COLORS[i % DONUT_COLORS.length],
  }))
  if (tailSum > 0) {
    profitSlices.push({
      categoryId:   `others-${tail.length}`,
      categoryPath: `Others (${tail.length})`,
      profit:       tailSum,
      share:        totalProfitPool > 0 ? tailSum / totalProfitPool : 0,
      color:        OTHERS_COLOR,
    })
  }

  const lossItems: LossItem[] = losing.slice(0, 5).map(r => ({
    categoryId:   r.categoryId,
    categoryPath: r.categoryPath,
    loss:         r.loss,
  }))

  return { profitSlices, lossItems, totalProfit, marginPct }
}

function compactINR(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 10_000_000) return `${sign}₹${(a / 10_000_000).toFixed(1)}Cr`
  if (a >= 100_000)    return `${sign}₹${(a / 100_000).toFixed(1)}L`
  if (a >= 1_000)      return `${sign}₹${(a / 1_000).toFixed(1)}k`
  return `${sign}₹${Math.round(a)}`
}
