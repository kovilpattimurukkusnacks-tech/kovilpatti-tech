import { Box, Chip } from '@mui/material'

/**
 * Renders a dispatched-qty cell consistently across request views.
 *
 *   • qty == null            → dim "—"            (not yet dispatched)
 *   • qty === 0              → "0 · Out of stock" (inventory had nothing)
 *   • 0 < qty < requested    → red bold number    (partial fulfilment)
 *   • qty === requested      → plain number       (fully delivered)
 *   • qty > requested        → amber bold number  (over-dispatched — noted
 *                                                  29-Jun-2026 client req,
 *                                                  not an error but worth
 *                                                  surfacing)
 *
 * Used in detail items tables and list grids' Dispatched columns.
 */
export function DispatchedCell({ qty, requested, received }: {
  qty: number | null
  requested: number
  /** Shop's reported qty at confirm-receipt (02-Jul-2026). When set AND
   *  different from dispatched, the cell renders "dispatched → received"
   *  stacked so the shop-reported number is the eye-catch. Null =
   *  no discrepancy → cell falls back to just showing dispatched. */
  received?: number | null
}) {
  if (qty == null) {
    return <span className="text-[#1F1F1F]/40">—</span>
  }
  // Shop reported a different count on receive — show BOTH, received wins the eye.
  if (received != null && received !== qty) {
    const short = received < qty
    const color = short ? '#C62828' : '#E65100'
    return (
      <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15 }}>
        <Box sx={{ fontSize: 12, color, fontWeight: 700 }}>
          {received}
          <Box component="span" sx={{ ml: 0.5, fontSize: 9, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>
            received
          </Box>
        </Box>
        <Box sx={{ fontSize: 10, color: '#1F1F1F77', fontWeight: 500 }}>
          dispatched {qty}
        </Box>
      </Box>
    )
  }
  if (qty === 0) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, justifyContent: 'flex-end' }}>
        <span style={{ color: '#C62828', fontWeight: 700 }}>0</span>
        <Chip
          label="Out of stock"
          size="small"
          sx={{
            height: 18,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.3,
            bgcolor: '#C62828',
            color: '#FFFFFF',
            '& .MuiChip-label': { px: 0.75 },
          }}
        />
      </Box>
    )
  }
  if (qty < requested) {
    return <span style={{ color: '#C62828', fontWeight: 600 }}>{qty}</span>
  }
  if (qty > requested) {
    return <span style={{ color: '#E65100', fontWeight: 600 }}>{qty}</span>
  }
  return <>{qty}</>
}
