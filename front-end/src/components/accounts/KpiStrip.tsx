import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { ArrowDownLeft, ArrowUpRight, ClipboardList, TrendingUp } from 'lucide-react'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import type { AccountsSummaryDto, AccountsView } from '../../api/accounts/types'

type Props = {
  data: AccountsSummaryDto | undefined
  loading: boolean
  /** Active view / lens. Drives which KPI cards render (19-Jun-2026, client #13). */
  view?: AccountsView
}

/**
 * 4-card KPI strip at the top of the Accounts dashboard, in reading order
 * Requested → Dispatched → Returns → Net, where Net = Dispatched − Returns
 * so the strip visibly adds up. The Net card uses the gold gradient to draw
 * the eye; the rest are cream surfaces matching the rest of the app. Every
 * rupee label carries "(at MRP)" so consumers don't mistake it for revenue.
 *
 * Deliberately NO Adjustments card here: qty edits update the live
 * Dispatched figure directly, so a peer-level Adjustments number reads as
 * "money to add" and double-counts. It also uses a different date anchor
 * (edited_at vs received_at), so it never reconciles against the
 * Requested→Dispatched gap — confusing next to them. The edits total + log
 * live on the Adjustments log table instead. (Tried 06-Jun-2026, removed.)
 */
export default function KpiStrip({ data, loading, view = 'all' }: Props) {
  // Build the full card set once, then filter by the active view.
  // 'all' shows everything; each dim view shows ONLY its own card so the
  // strip clearly reframes around that dimension (lens-mode).
  const allCards = [
    {
      dim: 'requested' as const,
      label: 'Requested (at MRP)',
      value: data?.requestedAmount,
      secondary: data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ClipboardList size={18} />,
      accent: undefined as 'net' | 'returns' | undefined,
    },
    {
      dim: 'dispatched' as const,
      label: 'Dispatched (at MRP)',
      value: data?.dispatchedAmount,
      secondary: data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ArrowUpRight size={18} />,
      accent: undefined as 'net' | 'returns' | undefined,
    },
    {
      dim: 'returns' as const,
      label: 'Returns (at MRP)',
      value: data?.returnsAmount,
      secondary: data ? `${data.returnsRequestCount} return${data.returnsRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ArrowDownLeft size={18} />,
      accent: 'returns' as const,
    },
    {
      dim: 'net' as const,
      label: 'Net (at MRP)',
      value: data?.netAmount,
      secondary: data ? `${data.activeShopCount} active shop${data.activeShopCount === 1 ? '' : 's'}` : undefined,
      icon: <TrendingUp size={18} />,
      accent: 'net' as const,
    },
  ]

  // Map view → which dims to show. Net belongs to 'all' only since it's a
  // composite (Dispatched − Returns) — surfacing it inside a single-dim view
  // would be misleading.
  const dimsByView: Record<AccountsView, ReadonlyArray<typeof allCards[number]['dim']>> = {
    all:        ['requested', 'dispatched', 'returns', 'net'],
    requested:  ['requested'],
    dispatched: ['dispatched'],
    returns:    ['returns'],
  }
  const cards = allCards.filter(c => dimsByView[view].includes(c.dim))

  // Grid column count tracks the visible card count so a single card doesn't
  // stretch the full page width (looks awkward). When only one card shows
  // (Requested / Dispatched / Returns single-dim views), the strip is
  // width-capped AND centered with mx:'auto' so it sits in the middle of
  // the page instead of clinging to the left edge.
  const cols = Math.min(cards.length, 4)
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: cols === 1 ? '1fr' : '1fr 1fr',
          md: `repeat(${cols}, minmax(220px, 1fr))`,
        },
        gap: 2,
        // alignSelf overrides the parent Stack's default `align-items: stretch`
        // so the maxWidth actually constrains the child; mx:'auto' then
        // pushes equal margin left/right for horizontal centering.
        ...(cols === 1 ? { maxWidth: 360, mx: 'auto', alignSelf: 'center', width: '100%' } : {}),
      }}
    >
      {cards.map(c => (
        <KpiCard
          key={c.dim}
          label={c.label}
          value={c.value}
          secondary={c.secondary}
          icon={c.icon}
          loading={loading}
          accent={c.accent}
        />
      ))}
    </Box>
  )
}

function KpiCard({
  label, value, secondary, icon, loading, accent,
}: {
  label: string
  value: number | undefined
  secondary: string | undefined
  icon: React.ReactNode
  loading: boolean
  /** 'net' = gold gradient. 'returns' = red tint. Default = cream. */
  accent?: 'net' | 'returns'
}) {
  const isNet     = accent === 'net'
  const isReturns = accent === 'returns'

  return (
    <Card
      sx={{
        border: '2px solid #1F1F1F',
        boxShadow: '4px 4px 0 0 #FCD835',
        background: isNet ? GOLD_GRADIENT : '#FFFBE6',
        color: '#1F1F1F',
      }}
    >
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography
            variant="caption"
            sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11 }}
          >
            {label}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>{icon}</Box>
        </Box>
        {loading
          ? <Skeleton variant="text" width="80%" height={32} />
          : (
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: isReturns ? '#C62828' : '#1F1F1F',
                lineHeight: 1.1,
              }}
            >
              {formatINR(value)}
            </Typography>
          )}
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.7, fontWeight: 600 }}>
          {loading ? <Skeleton width="60%" /> : (secondary ?? ' ')}
        </Typography>
      </CardContent>
    </Card>
  )
}
