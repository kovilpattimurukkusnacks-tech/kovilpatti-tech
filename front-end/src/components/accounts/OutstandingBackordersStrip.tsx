import { Box, Card, CardContent, Chip, Skeleton, Typography } from '@mui/material'
import { Hourglass } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OutstandingBackorderDto } from '../../api/stock-requests/types'
import { formatINR } from '../../utils/format'

type Props = {
  data: OutstandingBackorderDto[] | undefined
  loading: boolean
}

/**
 * Pipeline-scoped strip on the admin Accounts dashboard showing Pending
 * Backorder requests. Deliberately NOT date-filtered — a back-order raised
 * on 29-Jan may not close until 3-Feb, and admin needs to see it on the
 * Feb accounts screen regardless of the current date range.
 *
 * Zero back-orders → returns null so the dashboard stays clean.
 */
export default function OutstandingBackordersStrip({ data, loading }: Props) {
  const navigate = useNavigate()

  if (loading) {
    return (
      <Card sx={{ border: '2px solid #1F1F1F', borderStyle: 'dashed' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Skeleton width="60%" />
        </CardContent>
      </Card>
    )
  }

  if (!data || data.length === 0) return null

  const totalAmount = data.reduce((s, r) => s + r.totalAmount, 0)
  const stale = data.filter(r => r.daysSinceSubmitted > 3).length
  const oldest = data[0]  // SP returns ORDER BY submitted_at ASC → row 0 = oldest

  return (
    <Card sx={{
      border: '2px solid #1F1F1F',
      borderStyle: 'dashed',
      background: '#FFE0B2',
    }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#7C4A00' }}>
            <Hourglass size={18} />
            <Typography sx={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Outstanding back-orders
            </Typography>
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: 16, color: '#7C4A00' }}>
            {formatINR(totalAmount)}
          </Typography>
          <Typography sx={{ color: '#7C4A00CC', fontSize: 13, fontWeight: 600 }}>
            {data.length} pending — awaiting vendor stock
          </Typography>
          {stale > 0 && (
            <Chip
              label={`${stale} >3 days`}
              size="small"
              sx={{
                bgcolor: '#C62828', color: '#FFF', fontWeight: 700,
                height: 22, fontSize: 11,
              }}
            />
          )}
          {oldest && (
            <Box
              sx={{
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: '#7C4A00', textDecoration: 'underline',
              }}
              onClick={() => navigate(`/admin/requests/${oldest.id}`)}
            >
              oldest: {oldest.code} · {oldest.shopName} · {oldest.daysSinceSubmitted}d
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}
