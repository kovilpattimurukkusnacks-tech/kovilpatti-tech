import type { ReactNode } from 'react'
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Paper, Skeleton, Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { GOLD_GRADIENT } from '../../theme'
import { formatINR } from '../../utils/format'
import { CREAM, GAIN_GREEN, LOSS_RED } from './salesTheme'

// Shared components for the Phase 4d admin POS screens (Sales + Shop Stock).
// Palette + grid sx live in salesTheme.ts.

/** Pill-style segmented control — same look as the Accounts view tabs. */
export function SegmentedTabs<K extends string>({ value, options, onChange }: {
  value: K
  options: { key: K; label: string }[]
  onChange: (k: K) => void
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {options.map(o => {
        const active = o.key === value
        return (
          <Button
            key={o.key}
            size="small"
            disableElevation
            variant={active ? 'contained' : 'outlined'}
            onClick={() => onChange(o.key)}
            sx={{
              textTransform: 'none', fontWeight: 700, borderRadius: 999, px: 2,
              ...(active ? {} : { bgcolor: CREAM, color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.25)' }),
            }}
          >
            {o.label}
          </Button>
        )
      })}
    </Box>
  )
}

/** KPI tile. `money` false renders the value as a plain count. */
export function StatCard({ label, value, secondary, loading, tone, money = true }: {
  label: string
  value: number | undefined
  secondary?: string
  loading: boolean
  tone?: 'gold' | 'red'
  money?: boolean
}) {
  const red = tone === 'red'
  return (
    <Card
      sx={{
        height: '100%',
        border: '2px solid #1F1F1F',
        boxShadow: '4px 4px 0 0 #FCD835',
        background: tone === 'gold' ? GOLD_GRADIENT : CREAM,
        color: '#1F1F1F',
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11 }}>
          {label}
        </Typography>
        {loading
          ? <Skeleton variant="text" width="75%" height={32} />
          : (
            <Typography variant="h6" sx={{ fontWeight: 800, color: red ? LOSS_RED : '#1F1F1F', lineHeight: 1.2, mt: 0.5 }}>
              {value == null ? '—' : money ? formatINR(value) : value.toLocaleString('en-IN')}
            </Typography>
          )}
        <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.7, fontWeight: 600, minHeight: 18 }}>
          {loading ? <Skeleton width="55%" /> : (secondary ?? ' ')}
        </Typography>
      </CardContent>
    </Card>
  )
}

/** Bordered cream container for DataGrids / tables on these screens. */
export function GridPaper({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: '2px solid #1F1F1F',
        borderRadius: 2.5,
        overflow: 'hidden',
        boxShadow: '6px 6px 0 0 #FCD835',
        bgcolor: CREAM,
        ...sx,
      }}
    >
      {children}
    </Paper>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 3, mb: 1.25 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {children}
      </Typography>
      {right}
    </Box>
  )
}

export function BillStatusChip({ status }: { status: string }) {
  const cancelled = status === 'Cancelled'
  return (
    <Chip
      size="small"
      label={status}
      sx={{
        fontWeight: 700,
        bgcolor: cancelled ? '#FFEBEE' : '#EAF7EE',
        color: cancelled ? LOSS_RED : GAIN_GREEN,
        border: `1px solid ${cancelled ? LOSS_RED : GAIN_GREEN}`,
      }}
    />
  )
}

/** Signed money in red (negative) / green (positive) / muted (zero). */
export function SignedMoney({ value }: { value: number }) {
  if (value === 0) return <span style={{ color: '#1F1F1F80', fontWeight: 700 }}>{formatINR(0)}</span>
  const neg = value < 0
  return (
    <span style={{ color: neg ? LOSS_RED : GAIN_GREEN, fontWeight: 800 }}>
      {neg ? '−' : '+'}{formatINR(Math.abs(value))}
    </span>
  )
}

/**
 * Read-only detail dialog. Project rule: dialogs never close on backdrop
 * click or Escape — only the Close button (or the X) dismisses them.
 */
export function DetailDialog({ open, title, onClose, children, maxWidth = 'md' }: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  maxWidth?: 'sm' | 'md' | 'lg'
}) {
  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
        onClose()
      }}
      maxWidth={maxWidth}
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: CREAM, border: '2px solid #1F1F1F' } } }}
    >
      <DialogTitle sx={{ fontWeight: 800 }}>{title}</DialogTitle>
      <DialogContent dividers sx={{ bgcolor: CREAM }}>{children}</DialogContent>
      <DialogActions sx={{ bgcolor: CREAM }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700 }}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

/** Label / value pair for detail dialogs. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 700, color: '#1F1F1F99', fontSize: 11 }}>
        {label}
      </Typography>
      <Box sx={{ fontWeight: 600, fontSize: 14 }}>{children}</Box>
    </Box>
  )
}
