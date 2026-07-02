import { Box, Button, Chip, Collapse, Paper } from '@mui/material'
import { ListFilter, ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { GOLD_GRADIENT } from '../theme'

/**
 * Bordered container that groups the list-page filters (date / status / shop)
 * into one visually distinct card with labelled rows, instead of loose stacked
 * rows. Used by the Shop / Admin / Inventory stock-request list pages.
 *
 * No outer margin — the wrapping FilterPanel owns the spacing.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: '1.5px solid rgba(31,31,31,0.15)',
        borderRadius: 2.5,
        // Cream tint — matches the warm row backdrop on every data table.
        bgcolor: '#FFFBE6',
        px: 2,
        py: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      {children}
    </Paper>
  )
}

export type FilterPill = { key: string; label: string; onRemove?: () => void }

/**
 * Collapsible filter wrapper. Collapsed by default: shows a "Filter" toggle
 * plus a summary of the currently-active filters as removable pills — so the
 * page stays clean but the user can always SEE what's limiting the list
 * (critical because the date defaults to today). Expanding reveals the full
 * controls (the FilterBar) passed as children.
 */
export function FilterPanel({
  open, onToggle, pills, children,
}: {
  open: boolean
  onToggle: () => void
  pills: FilterPill[]
  children: ReactNode
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          onClick={onToggle}
          size="small"
          variant="outlined"
          startIcon={<ListFilter className="w-4 h-4" />}
          endIcon={open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: 999,
            color: '#1F1F1F',
            borderColor: 'rgba(31,31,31,0.25)',
            '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FFF8DC' },
          }}
        >
          Filter
        </Button>

        {/* Active-filter pills — only while collapsed (when open, the controls
            themselves show the state). Each pill's ✕ clears that one filter. */}
        {!open && pills.map(p => (
          <Chip
            key={p.key}
            label={p.label}
            onDelete={p.onRemove}
            size="small"
            sx={{
              borderRadius: 999,
              fontWeight: 600,
              background: GOLD_GRADIENT,
              color: '#1F1F1F',
              border: '1px solid #C28A00',
              '& .MuiChip-deleteIcon': { color: '#1F1F1F', '&:hover': { color: '#7B1A1A' } },
            }}
          />
        ))}
      </Box>

      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box sx={{ mt: 1.5 }}>{children}</Box>
      </Collapse>
    </Box>
  )
}

/**
 * One labelled row inside a FilterBar: a fixed-width uppercase label on the
 * left, the controls in the middle, and an optional right-aligned slot
 * (e.g. a search box).
 */
export function FilterRow({
  label, children, right,
}: {
  label: string
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Box
        sx={{
          width: 64,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: '#1F1F1F99',
        }}
      >
        {label}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
        {children}
      </Box>
      {right}
    </Box>
  )
}
