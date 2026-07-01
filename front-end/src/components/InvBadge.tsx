import { Box } from '@mui/material'

/**
 * Small "(inv)" badge rendered next to a product name when the line was
 * appended by the godown post-approval (added_by = 'Inventory'), not by
 * the shop at request-creation time. Lets the picker / shop / admin see
 * which items came in later. 01-Jul-2026.
 *
 * Kept tiny + muted so it doesn't fight the product name; also usable on
 * the thermal + A4 picklists since it's just plain text styling.
 */
export function InvBadge() {
  return (
    <Box
      component="span"
      sx={{
        ml: 0.75,
        display: 'inline-block',
        px: 0.6,
        py: 0,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: '#0277BD',
        bgcolor: 'rgba(2,119,189,0.10)',
        border: '1px solid rgba(2,119,189,0.35)',
        borderRadius: 0.75,
        verticalAlign: 'middle',
        lineHeight: 1.5,
      }}
      title="Added by inventory after approval"
      aria-label="Added by inventory"
    >
      inv
    </Box>
  )
}
