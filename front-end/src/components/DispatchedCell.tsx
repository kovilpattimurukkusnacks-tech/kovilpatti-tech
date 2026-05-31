import { Box, Chip } from '@mui/material'

/**
 * Renders a dispatched-qty cell consistently across request views.
 *
 *   • qty == null            → dim "—"            (not yet dispatched)
 *   • qty === 0              → "0 · Out of stock" (inventory had nothing)
 *   • 0 < qty < requested    → red bold number    (partial fulfilment)
 *   • qty === requested      → plain number       (fully delivered)
 *
 * Used in detail items tables and list grids' Dispatched columns.
 */
export function DispatchedCell({ qty, requested }: { qty: number | null; requested: number }) {
  if (qty == null) {
    return <span className="text-[#1F1F1F]/40">—</span>
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
  return <>{qty}</>
}
