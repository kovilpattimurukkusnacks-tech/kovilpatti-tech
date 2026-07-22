import { Box, Card, CardContent, Divider, Skeleton, Typography } from '@mui/material'
import { ArrowDownLeft, ArrowUpRight, ClipboardList, Receipt, ShoppingCart, TrendingUp, Wallet, Warehouse } from 'lucide-react'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import { totalInventoryExpenses, totalUtilities } from '../../hooks/useAccounts'
import { LOSS_RED, PROFIT_GREEN } from './ProfitLossChart'
import type {
  AccountsInventoryExpenseRowDto,
  AccountsSummaryDto,
  AccountsUtilityRowDto,
  AccountsView,
} from '../../api/accounts/types'

type Props = {
  data: AccountsSummaryDto | undefined
  loading: boolean
  /** Active view / lens. Drives which KPI cards render (19-Jun-2026, client #13). */
  view?: AccountsView
  /** Raw per-shop-per-category shop-expense rows for the current filter
   *  range (15-Jul-2026). Optional — when omitted the Shop Expenses /
   *  Net Profit cards are hidden even in views that would normally
   *  include them. We accept the raw rows (not a pre-summed total) so
   *  the Shop Expenses card can render its per-category hover tooltip
   *  without a second prop. Total is computed internally. */
  utilityRows?: AccountsUtilityRowDto[]
  /** Company-wide Inventory-role staff salary total for the range
   *  (18-Jul-2026) — godowns aren't shop-scoped, so this is a single
   *  figure, not a breakdown. Subtracts from Net Profit as its own line,
   *  separate from (not blended into) Shop Expenses. */
  godownExpenseAmount?: number
  /** Raw per-inventory-per-category operational expense rows
   *  (21-Jul-2026). Combined with `godownExpenseAmount` under the
   *  same "Godown Expenses" tile — accepted as rows (not a scalar)
   *  so the tile can render a per-category hover tooltip without
   *  a second prop, matching the shop-side pattern. */
  inventoryExpenseRows?: AccountsInventoryExpenseRowDto[]
}

/**
 * KPI strip at the top of the Accounts dashboard.
 *
 * 'all' view (15-Jul-2026 redesign, client req: "advanced + premium"):
 *   Bento layout. Big Net P&L hero card on the left with an inline
 *   Gross P&L + Utilities breakdown, so the client's actual question
 *   ("did I make money?") is answered before their eye even lands on
 *   the supporting numbers. Right side: 3×2 grid of supporting metrics
 *   (Requested / Dispatched / Returns / Purchased / Utilities / Net at MRP).
 *
 * Other views (requested / dispatched / returns / purchased):
 *   Original horizontal grid — the lens is focused, no derived "answer"
 *   card needed. Same card visual as before.
 *
 * Deliberately NO Adjustments card here: qty edits update the live
 * Dispatched figure directly, so a peer-level Adjustments number reads as
 * "money to add" and double-counts. It also uses a different date anchor
 * (edited_at vs received_at), so it never reconciles against the
 * Requested→Dispatched gap. The edits total + log live on the
 * Adjustments log table instead. (Tried 06-Jun-2026, removed.)
 */
export default function KpiStrip({ data, loading, view = 'all', utilityRows, godownExpenseAmount, inventoryExpenseRows }: Props) {
  // Bento layout is only meaningful on the composite 'all' view AND when
  // shop expenses have been fetched — that's when the Net P&L hero has
  // enough information to render its mini breakdown. Everything else
  // falls back to the classic grid.
  if (view === 'all' && utilityRows != null) {
    return <BentoLayout data={data} loading={loading} utilityRows={utilityRows} godownExpenseAmount={godownExpenseAmount} inventoryExpenseRows={inventoryExpenseRows} />
  }
  return <ClassicGrid data={data} loading={loading} view={view} utilityRows={utilityRows} godownExpenseAmount={godownExpenseAmount} inventoryExpenseRows={inventoryExpenseRows} />
}

// ══════════════════ Bento (all view) ══════════════════

function BentoLayout({ data, loading, utilityRows, godownExpenseAmount, inventoryExpenseRows }: {
  data: AccountsSummaryDto | undefined
  loading: boolean
  utilityRows: AccountsUtilityRowDto[]
  godownExpenseAmount?: number
  inventoryExpenseRows?: AccountsInventoryExpenseRowDto[]
}) {
  // Derived values — computed once, used across the hero + supporting cards.
  const utilitiesTotal = totalUtilities(utilityRows)
  const inventoryExpenseAmount = totalInventoryExpenses(inventoryExpenseRows)
  // 21-Jul-2026: godown-side total = staff salary (godownExpenseAmount) +
  // operational expenses (inventoryExpenseAmount). Combined in one tile.
  const godownTotal = (godownExpenseAmount ?? 0) + inventoryExpenseAmount
  const gross = data ? data.netAmount - data.purchaseAmount : undefined
  const netProfit = gross != null ? gross - utilitiesTotal - godownTotal : undefined

  return (
    <Box
      sx={{
        display: 'grid',
        // Hero (1.4fr) + four 1fr supporting cols on md+ (widened from three
        // to fit the new Godown Expenses card, 18-Jul-2026). On sm the hero
        // spans two cols above a 2-wide supporting grid. On xs everything
        // stacks single-column with the hero on top.
        gridTemplateColumns: {
          xs: '1fr',
          sm: '1fr 1fr',
          md: '1.4fr repeat(4, 1fr)',
        },
        gridTemplateAreas: {
          xs: `
            "hero"
            "req"
            "disp"
            "ret"
            "pur"
            "uti"
            "god"
            "net"
          `,
          sm: `
            "hero hero"
            "req  disp"
            "ret  pur"
            "uti  god"
            "net  net"
          `,
          md: `
            "hero req  disp ret  pur"
            "hero uti  god  net  .  "
          `,
        },
        gap: 2,
      }}
    >
      <Box sx={{ gridArea: 'hero' }}>
        <NetProfitHero
          netProfit={netProfit}
          gross={gross}
          utilities={utilitiesTotal}
          godownExpenses={godownTotal}
          loading={loading}
        />
      </Box>

      {/* Supporting cards — same visual language as the classic grid,
          just laid into the bento grid areas. */}
      <Box sx={{ gridArea: 'req' }}>
        <KpiCard
          label="Requested (at MRP)"
          value={data?.requestedAmount}
          secondary={data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined}
          icon={<ClipboardList size={18} />}
          loading={loading}
        />
      </Box>
      <Box sx={{ gridArea: 'disp' }}>
        <KpiCard
          label="Dispatched (at MRP)"
          value={data?.dispatchedAmount}
          secondary={data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined}
          icon={<ArrowUpRight size={18} />}
          loading={loading}
        />
      </Box>
      <Box sx={{ gridArea: 'ret' }}>
        <KpiCard
          label="Returns (at MRP)"
          value={data?.returnsAmount}
          secondary={data ? `${data.returnsRequestCount} return${data.returnsRequestCount === 1 ? '' : 's'}` : undefined}
          icon={<ArrowDownLeft size={18} />}
          loading={loading}
          accent="returns"
        />
      </Box>
      <Box sx={{ gridArea: 'pur' }}>
        <KpiCard
          label="Purchased (at Cost)"
          value={data?.purchaseAmount}
          secondary={data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined}
          icon={<ShoppingCart size={18} />}
          loading={loading}
        />
      </Box>
      <Box sx={{ gridArea: 'uti' }}>
        <KpiCard
          label="Shop Expenses"
          value={utilitiesTotal}
          secondary="rent, electricity, salary, …"
          icon={<Receipt size={18} />}
          loading={loading}
        />
      </Box>
      <Box sx={{ gridArea: 'god' }}>
        <KpiCard
          label="Godown Expenses"
          value={godownTotal}
          secondary="staff + operational"
          icon={<Warehouse size={18} />}
          loading={loading}
        />
      </Box>
      <Box sx={{ gridArea: 'net' }}>
        <KpiCard
          label="Net (at MRP)"
          value={data?.netAmount}
          secondary={data ? `${data.activeShopCount} active shop${data.activeShopCount === 1 ? '' : 's'}` : undefined}
          icon={<TrendingUp size={18} />}
          loading={loading}
        />
      </Box>
    </Box>
  )
}

/** The bento's anchor card. Big signed Net P&L number, with an inline
 *  Gross P&L + Utilities breakdown below so the client sees WHY it's
 *  positive/negative without hovering.
 *
 *  Profit → gold gradient background (brand hero treatment).
 *  Loss   → red border + red-tinted background so a loss period reads
 *           at a glance across the room. Number stays large regardless. */
function NetProfitHero({ netProfit, gross, utilities, godownExpenses, loading }: {
  netProfit: number | undefined
  gross: number | undefined
  utilities: number
  godownExpenses: number
  loading: boolean
}) {
  const isLoss  = netProfit != null && netProfit < 0
  const isBreak = netProfit === 0
  const label   = isLoss ? 'Net Loss' : isBreak ? 'Break-even' : 'Net Profit'

  return (
    <Card
      sx={{
        height: '100%',
        border: `2px solid ${isLoss ? LOSS_RED : '#1F1F1F'}`,
        boxShadow: '4px 4px 0 0 #FCD835',
        background: isLoss ? '#FFEBEE' : GOLD_GRADIENT,
        color: '#1F1F1F',
      }}
    >
      <CardContent sx={{
        p: { xs: 2.5, md: 3 },
        '&:last-child': { pb: { xs: 2.5, md: 3 } },
        // Stretch to fill the hero grid cell — flex-column so the eyebrow
        // hugs the top, the big number sits centred-ish, and the mini
        // breakdown anchors to the bottom.
        display: 'flex', flexDirection: 'column', height: '100%',
        gap: 1.5,
      }}>
        {/* Eyebrow + icon */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{
            textTransform: 'uppercase', letterSpacing: 1.4,
            fontWeight: 800, fontSize: 11, color: isLoss ? LOSS_RED : '#1F1F1F',
          }}>
            {label}
          </Typography>
          <Box sx={{ opacity: 0.7, display: 'flex' }}>
            <Wallet size={22} />
          </Box>
        </Box>

        {/* Big number — signed. Empty on loading; on data the abs value
            renders with a signed prefix so a loss reads unambiguously. */}
        {loading || netProfit == null
          ? <Skeleton variant="text" width="70%" height={56} />
          : (
            <Typography sx={{
              fontWeight: 800,
              fontSize: { xs: 32, sm: 36, md: 40 },
              lineHeight: 1.05,
              color: isLoss ? LOSS_RED : '#1F1F1F',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {isLoss ? '−' : isBreak ? '' : '+'}{formatINR(Math.abs(netProfit))}
            </Typography>
          )}

        <Typography sx={{
          fontSize: 12, fontWeight: 600, color: isLoss ? '#8B0000CC' : '#1F1F1F99',
          letterSpacing: 0.3,
        }}>
          after shop &amp; godown expenses
        </Typography>

        {/* Push the mini breakdown to the bottom of the flex column. */}
        <Box sx={{ flexGrow: 1 }} />

        {/* Inline mini breakdown — Gross P&L + Utilities, so the answer's
            derivation is visible on the card itself. Divider matches the
            border tone. */}
        <Divider sx={{
          borderColor: isLoss ? '#8B000033' : '#1F1F1F22',
          borderStyle: 'dashed',
        }} />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {loading || gross == null ? (
            <>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="70%" />
            </>
          ) : (
            <>
              <MiniLine
                label="Gross P&L"
                signed={gross}
                onLossHero={isLoss}
              />
              <MiniLine
                label="Shop Expenses"
                signed={-utilities}   /* shop expenses always subtract */
                onLossHero={isLoss}
                muted
              />
              <MiniLine
                label="Godown Expenses"
                signed={-godownExpenses}   /* godown expenses always subtract */
                onLossHero={isLoss}
                muted
              />
            </>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}

/** One row in the hero's mini breakdown. Label on the left, signed
 *  amount on the right — green for positive, red for negative. On the
 *  loss-tinted hero, muted contrast is bumped to stay readable against
 *  the pink background. */
function MiniLine({ label, signed, onLossHero, muted = false }: {
  label: string
  /** Signed number — negative renders with a leading minus + red color. */
  signed: number
  onLossHero: boolean
  /** Slightly quieter styling for the "cost" line so the positive
   *  intermediate (Gross P&L) stays the eye-catcher. */
  muted?: boolean
}) {
  const isPositive = signed > 0
  const sign  = isPositive ? '+' : signed < 0 ? '−' : ''
  const color = isPositive
    ? PROFIT_GREEN
    : signed < 0
      ? LOSS_RED
      : onLossHero ? '#8B0000CC' : '#1F1F1F99'

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
      <Typography sx={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: onLossHero ? '#8B0000CC' : '#1F1F1F99',
        opacity: muted ? 0.9 : 1,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: 13.5, fontWeight: 800, color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {sign}{formatINR(Math.abs(signed))}
      </Typography>
    </Box>
  )
}

// ══════════════════ Classic grid (non-'all' views) ══════════════════

function ClassicGrid({ data, loading, view, utilityRows, godownExpenseAmount, inventoryExpenseRows }: {
  data: AccountsSummaryDto | undefined
  loading: boolean
  view: AccountsView
  utilityRows: AccountsUtilityRowDto[] | undefined
  godownExpenseAmount: number | undefined
  inventoryExpenseRows: AccountsInventoryExpenseRowDto[] | undefined
}) {
  // Grand total driven by rows — same helper used by DashboardHero, so
  // both pages compute the total identically. Undefined when rows haven't
  // been fetched yet.
  const utilitiesTotal = utilityRows ? totalUtilities(utilityRows) : undefined
  // 21-Jul-2026: godown-side total = staff salary + operational expenses.
  const inventoryExpenseAmount = totalInventoryExpenses(inventoryExpenseRows)
  const godownTotal = (godownExpenseAmount ?? 0) + inventoryExpenseAmount
  // Net Profit = Gross Profit (net_amount − purchase_amount) − Shop Expenses − Godown Expenses.
  const netProfit = data == null || utilitiesTotal == null || godownExpenseAmount == null
    ? undefined
    : (data.netAmount - data.purchaseAmount) - utilitiesTotal - godownTotal

  const allCards = [
    {
      dim: 'purchased' as const,
      label: 'Purchased (at Cost)',
      value: data?.purchaseAmount,
      secondary: data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ShoppingCart size={18} />,
      accent: undefined as 'net' | 'returns' | 'loss' | undefined,
    },
    {
      dim: 'requested' as const,
      label: 'Requested (at MRP)',
      value: data?.requestedAmount,
      secondary: data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ClipboardList size={18} />,
      accent: undefined,
    },
    {
      dim: 'dispatched' as const,
      label: 'Dispatched (at MRP)',
      value: data?.dispatchedAmount,
      secondary: data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined,
      icon: <ArrowUpRight size={18} />,
      accent: undefined,
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
    {
      dim: 'utilities' as const,
      label: 'Shop Expenses',
      value: utilitiesTotal,
      secondary: 'rent, electricity, salary, …',
      icon: <Receipt size={18} />,
      accent: undefined,
    },
    {
      dim: 'godown' as const,
      label: 'Godown Expenses',
      // 21-Jul-2026: combined staff salary + operational expenses.
      value: godownTotal,
      secondary: 'staff + operational',
      icon: <Warehouse size={18} />,
      accent: undefined,
    },
    {
      dim: 'netProfit' as const,
      label: netProfit != null && netProfit < 0 ? 'Net Loss' : 'Net Profit',
      value: netProfit != null ? Math.abs(netProfit) : undefined,
      secondary: 'after shop & godown expenses',
      icon: <Wallet size={18} />,
      accent: (netProfit != null && netProfit < 0 ? 'loss' : 'net') as 'net' | 'returns' | 'loss',
    },
  ]

  const dimsByView: Record<AccountsView, ReadonlyArray<typeof allCards[number]['dim']>> = {
    all:        ['purchased', 'requested', 'dispatched', 'returns', 'net', 'utilities', 'godown', 'netProfit'],
    requested:  ['requested'],
    dispatched: ['purchased', 'dispatched'],
    returns:    ['returns'],
    purchased:  ['purchased', 'net', 'utilities', 'godown', 'netProfit'],
  }
  const cards = allCards
    .filter(c => dimsByView[view].includes(c.dim))
    .filter(c => (c.dim === 'utilities' || c.dim === 'godown' || c.dim === 'netProfit') ? utilitiesTotal != null : true)

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

// ══════════════════ Shared supporting card ══════════════════

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
        height: '100%',
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
          {loading ? <Skeleton width="60%" /> : (secondary ?? ' ')}
        </Typography>
      </CardContent>
    </Card>
  )
}
