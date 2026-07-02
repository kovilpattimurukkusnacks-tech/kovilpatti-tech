import { Box, Chip } from '@mui/material'
import HourglassBottomIcon from '@mui/icons-material/HourglassBottom'

/** Uniform chip for back-order-flagged requests. Rendered on:
 *   • Shop / Inventory / Admin list rows where requestType === 'Backorder'
 *   • Detail pages next to the request code
 *   • Print outputs (see PrintRequestPicklist / Thermal / Cumulative)
 *
 *  Amber-on-cream matches the existing over-dispatch styling (#FFE0B2) so
 *  the shop/inv user picks up "something's off from the usual order" at a
 *  glance without needing to read the text.
 */
export function BackorderChip({ size = 'small', compact = false }: {
  size?: 'small' | 'medium'
  compact?: boolean
}) {
  return (
    <Chip
      icon={<HourglassBottomIcon fontSize="small" />}
      label={compact ? 'B/O' : 'Back-order'}
      size={size}
      sx={{
        bgcolor: '#FFE0B2',
        color: '#7C4A00',
        border: '1px solid #E8A758',
        fontWeight: 600,
        letterSpacing: 0.3,
        '& .MuiChip-icon': { color: '#7C4A00' },
      }}
    />
  )
}

/** ETA sub-label; renders "· ETA <date>" when a value is present, else null.
 *  Uses IST calendar day formatting to match the rest of the app. */
export function BackorderEtaText({ expectedArrivalAt }: { expectedArrivalAt: string | null }) {
  if (!expectedArrivalAt) return null
  const d = new Date(expectedArrivalAt)
  if (Number.isNaN(d.getTime())) return null
  const text = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return (
    <Box component="span" sx={{ color: '#7C4A00', fontWeight: 500 }}>
      · ETA {text}
    </Box>
  )
}
