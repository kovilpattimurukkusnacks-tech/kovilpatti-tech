import { Chip, Tooltip } from '@mui/material'
import StarIcon from '@mui/icons-material/Star'

/** Uniform chip for shop-declared Special Requests (06-Jul-2026).
 *  Replaces the retired BackorderChip. Rendered on:
 *    • Shop / Inventory / Admin list rows where isSpecial === true
 *    • Detail pages next to the request code
 *    • Sticky top banner across every page for un-received specials
 *    • Print outputs (picklist / thermal / cumulative)
 *
 *  Amber-on-cream matches the retired B/O chip so muscle memory carries
 *  over — "something's off from the usual order" is still the signal.
 *  When a special_label is provided (e.g. "Diwali stock 2026"), it shows
 *  as a tooltip so the chip stays compact but the label is discoverable.
 */
export function SpecialRequestChip({
  size = 'small',
  compact = false,
  label,
}: {
  size?: 'small' | 'medium'
  compact?: boolean
  /** User-supplied special_label. Tooltip target when present. Null / empty
   *  → chip stands on its own with the generic "Special" text. */
  label?: string | null
}) {
  const chip = (
    <Chip
      icon={<StarIcon fontSize="small" />}
      label={compact ? 'SP' : (label?.trim() || 'Special')}
      size={size}
      sx={{
        bgcolor: '#FFE0B2',
        color: '#7C4A00',
        border: '1px solid #E8A758',
        fontWeight: 600,
        letterSpacing: 0.3,
        maxWidth: 220,
        '& .MuiChip-label': {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
        '& .MuiChip-icon': { color: '#7C4A00' },
      }}
    />
  )

  // When compact + a label exists, show it on hover so the sender still
  // gets to see "Diwali stock 2026" without stealing horizontal space.
  if (compact && label?.trim()) {
    return <Tooltip title={label.trim()}>{chip}</Tooltip>
  }
  return chip
}
