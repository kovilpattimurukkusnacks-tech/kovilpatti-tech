import { Box, Card, CardContent, Chip, Skeleton, Typography } from '@mui/material'
import { Truck } from 'lucide-react'
import type { AccountsInTransitDto } from '../../api/accounts/types'
import { formatINR } from '../../utils/format'

type Props = {
  data: AccountsInTransitDto | undefined
  loading: boolean
}

/**
 * Strip below the KPI cards showing money currently in-transit (Orders
 * dispatched but not yet received). Independent of the date filter —
 * it's a "right now" snapshot. Collapsed (hidden) when there are zero
 * in-transit Orders so the dashboard stays uncluttered in the common case.
 */
export default function InTransitStrip({ data, loading }: Props) {
  if (loading) {
    return (
      <Card sx={{ border: '2px solid #1F1F1F', borderStyle: 'dashed' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Skeleton width="50%" />
        </CardContent>
      </Card>
    )
  }

  if (!data || data.requestCount === 0) {
    return null
  }

  const ageDays = data.oldestDispatchedAt ? daysAgo(data.oldestDispatchedAt) : null

  return (
    <Card sx={{ border: '2px solid #1F1F1F', borderStyle: 'dashed', background: '#FFF8E1' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#1F1F1F' }}>
            <Truck size={18} />
            <Typography sx={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              In transit
            </Typography>
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: 16 }}>{formatINR(data.totalAmount)}</Typography>
          <Typography sx={{ color: '#1F1F1FB3', fontSize: 13, fontWeight: 600 }}>
            {data.requestCount} dispatched order{data.requestCount === 1 ? '' : 's'} not yet received
          </Typography>
          {ageDays != null && (
            <Typography sx={{ color: '#C62828', fontSize: 13, fontWeight: 700 }}>
              · oldest {ageDays} day{ageDays === 1 ? '' : 's'} ago
            </Typography>
          )}
          {/* Special-order slice inside the in-transit total (06-Jul-2026,
              client req). Only renders when specialCount > 0 so a clean
              in-transit set stays uncluttered. Amber chip echoes the
              Special Request visual language across the app. */}
          {data.specialCount > 0 && (
            <Chip
              label={`★ ${data.specialCount} Special · ${formatINR(data.specialAmount)}`}
              size="small"
              sx={{
                bgcolor: '#FFB74D',
                border: '1px solid #E65100',
                color: '#3E2500',
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: 0.3,
                height: 24,
              }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  )
}

function daysAgo(isoUtc: string): number {
  const then = new Date(isoUtc).getTime()
  const now  = Date.now()
  return Math.max(0, Math.floor((now - then) / (24 * 60 * 60 * 1000)))
}
