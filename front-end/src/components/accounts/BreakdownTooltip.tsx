import { Box, Typography } from '@mui/material'
import { formatINR } from '../../utils/format'

/**
 * Shared primitives for the "brand breakdown card" style tooltips used
 * on the Accounts screens (Gross P&L / Net P&L / Utilities cell hovers
 * on ShopBreakdownTable, and Net-MRP KPI hover on KpiStrip).
 *
 * Every card here follows the same Kovilpatti card grammar:
 *   • cream ground (#FFFBE6)
 *   • 2px black border
 *   • offset gold drop-shadow (4px 4px 0 0 #FCD835)
 *   • dark text with warm brown-gold operator column
 *
 * Callers wrap these primitives in a MUI <Tooltip title={<BreakdownCard …>}>
 * with `brandTooltipSlotProps` applied so the container is transparent
 * and the card owns all visual weight. See ShopBreakdownTable.tsx for a
 * cell-level usage (with a dashed-underline hover cue), and KpiStrip.tsx
 * for a card-level usage (whole KPI card is the anchor).
 */

// ══════════════════ Tooltip slot styling ══════════════════
//
// Cream fill + black hairline on the arrow makes it look like the arrow
// visually extends the card's 2px black frame. Tooltip container itself
// is transparent so the child card provides all visible surface.
export const brandTooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: 'transparent',
      p: 0,
      maxWidth: 'none',
    },
  },
  arrow: {
    sx: {
      color: '#FFFBE6',
      '&::before': {
        border: '1.5px solid #1F1F1F',
        backgroundColor: '#FFFBE6',
      },
    },
  },
} as const

// ══════════════════ Card shell ══════════════════

/** Shared card shell for every breakdown tooltip. Header row (title +
 *  optional subtitle) + a gold-underlined body slot below. */
export function BreakdownCard({ title, subtitle, children }: {
  title: string
  /** Small line under the title — usually a shop name for row-level
   *  tooltips. Omit for aggregate-level tooltips (KPI strip). */
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Box sx={{
      // Kovilpatti card grammar — same border + offset gold shadow as
      // KPI cards + DataGrid, so the tooltip reads as "one of the app's
      // surfaces" instead of a floating overlay.
      minWidth: 300,
      bgcolor: '#FFFBE6',
      color:   '#1F1F1F',
      border: '2px solid #1F1F1F',
      boxShadow: '4px 4px 0 0 #FCD835',
      borderRadius: 1,
      overflow: 'hidden',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <Box sx={{
        px: 1.75, pt: 1.25, pb: subtitle ? 1 : 0.75,
        borderBottom: '2px solid #FCD835',
      }}>
        <Typography sx={{
          fontSize: 10, fontWeight: 800, letterSpacing: 1.4,
          textTransform: 'uppercase', color: '#1F1F1F',
        }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{
            fontSize: 12, fontWeight: 700, color: '#1F1F1FB3',
            mt: 0.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: 270,
          }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ px: 1.75, py: 1.25 }}>
        {children}
      </Box>
    </Box>
  )
}

// ══════════════════ Ledger primitives ══════════════════

/** One row in the ledger. Op column (`` / `−` / `+` / `Σ` / `=`) is
 *  fixed 14px so numbers align vertically down the column. */
export function BreakdownRow({ op, label, value, tone }: {
  op: '' | '−' | '+' | 'Σ' | '='
  label: string
  value: number
  /** input = plain dark, subtract = muted red, subtotal = bolder dark. */
  tone: 'input' | 'subtract' | 'subtotal'
}) {
  const labelColor  = tone === 'subtotal' ? '#1F1F1F' : '#1F1F1FB3'
  const valueColor  = tone === 'subtract' ? '#C62828CC' : '#1F1F1F'
  const valueWeight = tone === 'subtotal' ? 800 : 600
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '14px 1fr auto', alignItems: 'baseline',
      columnGap: 1, py: 0.35,
    }}>
      {/* Operator column uses a warm brown-gold — visible on cream without
          shouting, and picks up the same tone family as the header rule. */}
      <Box sx={{ color: '#8A6D3B', fontWeight: 800, fontSize: 12, textAlign: 'center' }}>{op}</Box>
      <Typography sx={{ fontSize: 12, color: labelColor, fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12.5, color: valueColor, fontWeight: valueWeight }}>
        {formatINR(value)}
      </Typography>
    </Box>
  )
}

/** Thin rule between ledger sections. Dashed = "these inputs combine
 *  into the next line". Solid = "this is the final equation." */
export function BreakdownDivider({ dashed = false }: { dashed?: boolean }) {
  return (
    <Box sx={{
      // Sit inside the ledger — 14px op-column + gap, so the rule visually
      // "underlines" the numeric column, not the label column.
      ml: '22px', my: 0.35,
      borderTop: `1px ${dashed ? 'dashed' : 'solid'} #1F1F1F33`,
    }} />
  )
}

/** Signed-result footer row shared by every breakdown — "= Gross Profit
 *  +₹22,653.50" (green) / "= Net Loss −₹2,376.50" (red) / etc. */
export function BreakdownResult({ label, signed }: {
  label: string
  /** Signed number: positive → profit / green, negative → loss / red,
   *  zero → break-even / muted. */
  signed: number
}) {
  const isBreakEven = signed === 0
  const isPositive  = signed > 0
  const color = isBreakEven ? '#1F1F1F66' : isPositive ? '#2E7D32' : '#C62828'
  const sign  = isPositive ? '+' : isBreakEven ? '' : '−'
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '14px 1fr auto', alignItems: 'baseline',
      columnGap: 1, pt: 0.5,
    }}>
      <Box sx={{ color, fontWeight: 800, fontSize: 14, textAlign: 'center' }}>=</Box>
      <Typography sx={{
        fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
        textTransform: 'uppercase', color: '#1F1F1F',
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: 15, fontWeight: 800, color,
      }}>
        {sign}{formatINR(Math.abs(signed))}
      </Typography>
    </Box>
  )
}

/** Signed subtotal row (Gross P&L midway through the Net P&L chain, or
 *  a similar mid-derivation number). Same shape as BreakdownRow but the
 *  value gets sign + green/red tint so the intermediate result reads at
 *  a glance without waiting for the final row. */
export function BreakdownSignedSubtotal({ label, signed }: { label: string; signed: number }) {
  const color = signed > 0 ? '#2E7D32' : signed < 0 ? '#C62828' : '#1F1F1F66'
  const sign  = signed > 0 ? '+' : signed < 0 ? '−' : ''
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '14px 1fr auto', alignItems: 'baseline',
      columnGap: 1, py: 0.35,
    }}>
      <Box sx={{ color: '#8A6D3B', fontWeight: 800, fontSize: 12, textAlign: 'center' }} />
      <Typography sx={{ fontSize: 12, color: '#1F1F1F', fontWeight: 800 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12.5, color, fontWeight: 800 }}>
        {sign}{formatINR(Math.abs(signed))}
      </Typography>
    </Box>
  )
}

/** Sum footer row — same shape as BreakdownResult but uses `Σ` operator
 *  and stays neutral-dark (not green/red), since the total is a plain
 *  addition, not a signed P&L number. Used by UtilitiesTooltip so the
 *  total reads as "sum of these lines" rather than an outcome. */
export function BreakdownSumTotal({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '14px 1fr auto', alignItems: 'baseline',
      columnGap: 1, pt: 0.5,
    }}>
      <Box sx={{ color: '#8A6D3B', fontWeight: 800, fontSize: 14, textAlign: 'center' }}>Σ</Box>
      <Typography sx={{
        fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
        textTransform: 'uppercase', color: '#1F1F1F',
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: 15, fontWeight: 800, color: '#1F1F1F',
      }}>
        {formatINR(value)}
      </Typography>
    </Box>
  )
}
