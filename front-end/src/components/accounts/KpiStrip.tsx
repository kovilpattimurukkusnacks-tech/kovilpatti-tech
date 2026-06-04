import { Box, Card, CardContent, Skeleton, Typography } from '@mui/material'
import { ArrowDownLeft, ArrowUpRight, ClipboardList, TrendingUp } from 'lucide-react'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import type { AccountsSummaryDto } from '../../api/accounts/types'

type Props = {
  data: AccountsSummaryDto | undefined
  loading: boolean
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
 * "money to add" and double-counts. The edits total + log live on the
 * Adjustments log table instead.
 */
export default function KpiStrip({ data, loading }: Props) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
        gap: 2,
      }}
    >
      <KpiCard
        label="Requested (at MRP)"
        value={data?.requestedAmount}
        secondary={data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined}
        icon={<ClipboardList size={18} />}
        loading={loading}
      />
      <KpiCard
        label="Dispatched (at MRP)"
        value={data?.dispatchedAmount}
        secondary={data ? `${data.dispatchedRequestCount} order request${data.dispatchedRequestCount === 1 ? '' : 's'}` : undefined}
        icon={<ArrowUpRight size={18} />}
        loading={loading}
      />
      <KpiCard
        label="Returns (at MRP)"
        value={data?.returnsAmount}
        secondary={data ? `${data.returnsRequestCount} return${data.returnsRequestCount === 1 ? '' : 's'}` : undefined}
        icon={<ArrowDownLeft size={18} />}
        loading={loading}
        accent="returns"
      />
      <KpiCard
        label="Net (at MRP)"
        value={data?.netAmount}
        secondary={data ? `${data.activeShopCount} active shop${data.activeShopCount === 1 ? '' : 's'}` : undefined}
        icon={<TrendingUp size={18} />}
        loading={loading}
        accent="net"
      />
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
