import type { SxProps, Theme } from '@mui/material'
import type { RequestStatus } from '../api/stock-requests/types'

/**
 * Per-status Chip color mapping used across every stock-request surface
 * (shop / inventory / admin lists + detail pages). Each of those pages
 * used to keep its own local copy of the same map; consolidated here on
 * 07-Jul-2026 so a color tweak like "Dispatched needs a distinct hue"
 * only changes one file.
 *
 * The theme's `primary` is near-black (see theme.ts) — using it as a
 * status color reads as generic. So Dispatched moved to `default` here
 * and picks up a purple sx override below (`STATUS_CHIP_SX`) so it
 * visually differs from Approved (info-blue) without stepping on the
 * app's gold brand palette.
 */
export const STATUS_COLOR: Record<
  RequestStatus,
  'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'
> = {
  // Drafts surface on the admin "My Drafts" preset (15-Jul-2026) — the
  // sx override below paints a distinctive warm brown-gold so they don't
  // blend with grey Cancelled rows. 'default' keeps the base structure
  // consistent; the sx wins on colours.
  Draft:      'default',
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  // Dispatched → default so the sx override below (purple) wins without
  // MUI's palette interfering with the border/text color.
  Dispatched: 'default',
  Received:   'success',
  Cancelled:  'default',
  // Returns' terminal state — green-success mirrors Received since the
  // goods have moved successfully (just in reverse).
  Accepted:   'success',
}

/**
 * Optional per-status sx overrides — only populated where MUI's palette
 * colors aren't enough. Currently only Dispatched needs one (purple to
 * differentiate from Approved's blue).
 *
 * Spread into the Chip's sx: `sx={{ ...baseSx, ...STATUS_CHIP_SX[status] }}`.
 */
export const STATUS_CHIP_SX: Partial<Record<RequestStatus, SxProps<Theme>>> = {
  Dispatched: {
    // Material purple 700 — reads as distinct from info-blue (Approved),
    // success-green (Received), warning-amber (Pending), error-red
    // (Rejected). Semantic fit: "in transit, on the way" = purple.
    borderColor: '#7B1FA2',
    color: '#7B1FA2',
    fontWeight: 700,
    '& .MuiChip-label': { fontWeight: 700 },
  },
  Draft: {
    // Warm brown-gold — reads as "in-progress / held" without clashing
    // with the amber orange used by Special Request highlights. Same
    // tone family as the operator column in the accounts breakdown
    // tooltips, so the visual grammar stays consistent across the app.
    borderColor: '#8A6D3B',
    color: '#8A6D3B',
    backgroundColor: '#FFF8DC',
    fontWeight: 700,
    '& .MuiChip-label': { fontWeight: 700 },
  },
}
