import { Box, Divider, Paper } from '@mui/material'
import type { StockRequestDto } from '../api/stock-requests/types'
import { formatINR } from '../utils/format'

/**
 * Two-section summary panel rendered below the items table on each request
 * detail page. Pure read-only — derives all values from the provided request.
 *
 * Top section: counts (products, requested qty, dispatched qty, short, OOS).
 * Bottom section: amounts (requested ₹, dispatched ₹).
 *
 * Rows that don't apply (no dispatch yet, no short lines, no OOS line) are
 * hidden to keep the panel tight.
 */
export function RequestSummary({ request }: { request: StockRequestDto }) {
  const items = request.items ?? []
  const dispatched = request.totalDispatchedQty
  const hasDispatch = dispatched != null

  const shortQty = hasDispatch ? Math.max(0, request.totalQty - dispatched) : 0
  const oosCount = hasDispatch ? items.filter(it => it.dispatchedQty === 0).length : 0

  const dispatchedAmount = items.reduce(
    (s, it) => s + (it.dispatchedQty ?? it.requestedQty) * it.unitPrice,
    0,
  )
  const isShortAmount = hasDispatch && dispatchedAmount < request.totalAmount

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        border: '2px solid #1F1F1F',
        bgcolor: '#FFFFFF',
        maxWidth: 520,
        ml: 'auto',  // right-align below the items table
      }}
    >
      <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 1 }}>
        Summary
      </Box>

      <SummaryRow label="Total products"      value={`${request.totalItems}`} />
      <SummaryRow label="Requested quantity"  value={`${request.totalQty} ${request.totalQty === 1 ? 'unit' : 'units'}`} />
      {hasDispatch && (
        <SummaryRow
          label="Dispatched quantity"
          value={`${dispatched} ${dispatched === 1 ? 'unit' : 'units'}`}
          danger={shortQty > 0}
        />
      )}
      {shortQty > 0 && (
        <SummaryRow label="Short" value={`${shortQty} ${shortQty === 1 ? 'unit' : 'units'}`} danger />
      )}
      {oosCount > 0 && (
        <SummaryRow
          label="Out of stock"
          value={`${oosCount} ${oosCount === 1 ? 'product' : 'products'}`}
          danger
        />
      )}

      <Divider sx={{ my: 1.25, borderColor: 'rgba(31,31,31,0.15)' }} />

      <SummaryRow label="Requested amount" value={formatINR(request.totalAmount)} />
      {hasDispatch && (
        <SummaryRow
          label="Dispatched amount"
          value={formatINR(dispatchedAmount)}
          danger={isShortAmount}
        />
      )}
    </Paper>
  )
}

function SummaryRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, py: 0.5 }}>
      <Box sx={{ fontSize: 13, color: '#1F1F1F99' }}>{label}</Box>
      <Box sx={{ fontSize: 14, fontWeight: 700, color: danger ? '#C62828' : '#1F1F1F' }}>{value}</Box>
    </Box>
  )
}
