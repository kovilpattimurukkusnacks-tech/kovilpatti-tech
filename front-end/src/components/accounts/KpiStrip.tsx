import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { ArrowDownLeft, ArrowUpRight, ClipboardList, Receipt, ShoppingCart, TrendingUp, Wallet } from 'lucide-react'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import { LOSS_RED } from './ProfitLossChart'
import type { AccountsSummaryDto, AccountsView } from '../../api/accounts/types'

type Props = {
  data: AccountsSummaryDto | undefined
  loading: boolean
  /** Active view / lens. Drives which KPI cards render (19-Jun-2026, client #13). */
  view?: AccountsView
  /** Grand-total shop operating expenses for the current filter range
   *  (15-Jul-2026). Optional — when omitted the Utilities / Net Profit
   *  cards are hidden even in views that would normally include them,
   *  so a page that doesn't fetch utilities doesn't render blanks. */
  utilitiesTotal?: number
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
export default function KpiStrip({ data, loading, view = 'all', utilitiesTotal }: Props) {
  // Net Profit = Gross Profit (net_amount − purchase_amount) − Utilities.
  // Signed — negative when the shops spent more than they earned in the
  // range. Computed here so both the KPI card and the fallback (no data
  // yet → undefined) go through one path.
  const netProfit = data == null || utilitiesTotal == null
    ? undefined
    : (data.netAmount - data.purchaseAmount) - utilitiesTotal

  // Build the full card set once, then filter by the active view.
  // 'all' shows everything; each dim view shows ONLY its own card so the
  // strip clearly reframes around that dimension (lens-mode).
  const allCards = [
    {
      // Purchased (at Cost) — net dispatched cost at purchase_price_snapshot
      // (12-Jul-2026, client ask). Sits FIRST so the owner reads cost before
      // the retail figures.
      dim: 'purchased' as const,
      label: 'Purchased (at Cost)',
      value: data?.purchaseAmount,
      secondary: data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ShoppingCart size={18} />,
      accent: undefined as 'net' | 'returns' | undefined,
    },
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
    // Operating expenses (Rent / Electricity / Salary / …) logged via the
    // Shop Utilities screen. Only surfaces when the caller supplied a total
    // (utilitiesTotal !== undefined) — pages that don't fetch the utilities
    // endpoint see this card and Net Profit hidden entirely (see dimsByView
    // + the filter below).
    {
      dim: 'utilities' as const,
      label: 'Utilities (Cost)',
      value: utilitiesTotal,
      secondary: 'shop bills in range',
      icon: <Receipt size={18} />,
      accent: undefined as 'net' | 'returns' | 'loss' | undefined,
    },
    // Net Profit = (Net at MRP − Purchased at Cost) − Utilities. Signed —
    // negative renders with a red tint (accent='loss') so a period that
    // slipped into a loss doesn't hide behind identical styling.
    {
      dim: 'netProfit' as const,
      label: netProfit != null && netProfit < 0 ? 'Net Loss' : 'Net Profit',
      value: netProfit != null ? Math.abs(netProfit) : undefined,
      secondary: 'after utilities',
      icon: <Wallet size={18} />,
      accent: (netProfit != null && netProfit < 0 ? 'loss' : 'net') as 'net' | 'returns' | 'loss',
    },
  ]

  // Map view → which dims to show. Net belongs to 'all' only since it's a
  // composite (Dispatched − Returns) — surfacing it inside a single-dim view
  // would be misleading.
  // Utilities / Net Profit (15-Jul-2026) show only in the composite views
  // ('all' and 'purchased') — they're cross-lens metrics that don't relate
  // to the single-dim slices (Requested / Dispatched / Returns).
  const dimsByView: Record<AccountsView, ReadonlyArray<typeof allCards[number]['dim']>> = {
    all:        ['purchased', 'requested', 'dispatched', 'returns', 'net', 'utilities', 'netProfit'],
    requested:  ['requested'],
    dispatched: ['purchased', 'dispatched'],
    returns:    ['returns'],
    // Purchased lens (12-Jul-2026 client req) — Purchased + Net pair so
    // the KPI strip shows "cost invested" alongside the "revenue at MRP"
    // it turns into. Profit/Loss shows up per-shop and per-category in
    // the tables below.
    purchased:  ['purchased', 'net', 'utilities', 'netProfit'],
  }
  // Additional guard: even when the view would include utilities / netProfit,
  // hide them if the caller didn't fetch utilities. Pages that don't opt in
  // shouldn't see blank cards.
  const cards = allCards
    .filter(c => dimsByView[view].includes(c.dim))
    .filter(c => (c.dim === 'utilities' || c.dim === 'netProfit') ? utilitiesTotal != null : true)

  // Grid column count tracks the visible card count so a single card doesn't
  // stretch the full page width (looks awkward). When only one card shows
  // (Requested / Dispatched / Returns single-dim views), the strip is
  // width-capped AND centered with mx:'auto' so it sits in the middle of
  // the page instead of clinging to the left edge.
  const cols = Math.min(cards.length, 5)
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
  /** 'net' = gold gradient. 'returns' / 'loss' = red-tinted number.
   *  'loss' additionally paints the border red so a period that slipped
   *  into a net loss reads at a glance. Default = cream. */
  accent?: 'net' | 'returns' | 'loss'
}) {
  const isNet     = accent === 'net'
  const isReturns = accent === 'returns'
  const isLoss    = accent === 'loss'
  const valueColor  = (isReturns || isLoss) ? LOSS_RED : '#1F1F1F'
  const borderColor = isLoss ? LOSS_RED : '#1F1F1F'

  return (
    <Card
      sx={{
        border: `2px solid ${borderColor}`,
        boxShadow: '4px 4px 0 0 #FCD835',
        background: isNet
          ? GOLD_GRADIENT
          : isLoss ? '#FFEBEE' : '#FFFBE6',
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
                color: valueColor,
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
