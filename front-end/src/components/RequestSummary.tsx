import { Box, Divider, Paper } from '@mui/material'
import type { StockRequestDto } from '../api/stock-requests/types'
import { formatINR } from '../utils/format'

type Variant =
  /** Default — right-aligned paper card with vertical rows. Used by the
   *  Admin detail page (and historically by Shop + Inventory before the
   *  19-Jun-2026 sticky-footer change). */
  | 'card'
  /** Horizontal compact strip designed for a sticky/fixed footer placement
   *  on Shop + Inventory detail pages — admin doesn't want to scroll to
   *  the bottom of the items table to see totals (client #14, 19-Jun-2026). */
  | 'footer'

/**
 * Summary panel rendered alongside a stock-request detail view. Pure
 * read-only — derives all values from the provided request. Pick the
 * layout via `variant`:
 *   • 'card'   — paper card (default), vertical rows, right-aligned.
 *   • 'footer' — horizontal compact strip for sticky/fixed bottom bar.
 *
 * Rows / chips that don't apply (no dispatch yet, no short lines, no OOS
 * line) are hidden so the panel stays tight.
 */
export function RequestSummary({ request, variant = 'card' }: {
  request: StockRequestDto
  variant?: Variant
}) {
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

  if (variant === 'footer') {
    // 19-Jun-2026 — Return requests use returned/accepted vocabulary instead
    // of dispatched. Same numeric columns (the BE reuses dispatched_qty as
    // accepted-qty for Returns per the Phase 2 convention) — just relabel.
    const isReturn = request.requestType === 'Return'
    // Order:  "X dispatched" / "Dispatched ₹Y" / "X short" / "X out of stock"
    // Return: "X returned"   / "Returned ₹Y"   / "X rejected"  (no OOS — N/A)
    const dispatchedNoun = isReturn ? 'returned'  : 'dispatched'
    const dispatchedCap  = isReturn ? 'Returned'  : 'Dispatched'
    const shortNoun      = isReturn ? 'rejected'  : 'short'
    // "Requested" reads weirdly on a Return ("shop requested its goods
    // back" is technically right but jargon-y). Returns: "Submitted".
    const requestedShort = isReturn ? 'submitted' : 'req'
    const requestedCap   = isReturn ? 'Submitted' : 'Requested'

    // Layout matches the New Stock Request cart bar:
    //   • LEFT — counts as a readable sentence (muted subtitle weight).
    //   • RIGHT — amounts in big bold so the rupee figures own the bar.
    return (
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: { xs: 1.5, sm: 3 },
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {/* LEFT — counts row, single readable sentence. "Out of stock" is
            spelled out (not abbreviated) so it's self-explanatory. */}
        <Box
          sx={{
            fontSize: { xs: 12, sm: 13 },
            color: '#1F1F1F99',
            fontWeight: 600,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.25,
            alignItems: 'baseline',
            minWidth: 0,
          }}
        >
          <span>{request.totalItems} {request.totalItems === 1 ? 'product' : 'products'}</span>
          <span>·</span>
          <span>{request.totalQty} {requestedShort} {request.totalQty === 1 ? 'unit' : 'units'}</span>
          {hasDispatch && (
            <>
              <span>·</span>
              <Box component="span" sx={{ color: shortQty > 0 ? '#C62828' : '#1F1F1F99' }}>
                {dispatched} {dispatchedNoun}
              </Box>
            </>
          )}
          {shortQty > 0 && (
            <>
              <span>·</span>
              <Box component="span" sx={{ color: '#C62828', fontWeight: 700 }}>
                {shortQty} {shortNoun}
              </Box>
            </>
          )}
          {/* Out of stock applies only to Orders (godown ran out). On a
              Return the concept doesn't translate — godown accepting zero
              of an item is just a normal rejection. Hide for Returns. */}
          {oosCount > 0 && !isReturn && (
            <>
              <span>·</span>
              <Box component="span" sx={{ color: '#C62828', fontWeight: 700 }}>
                {oosCount} out of stock
              </Box>
            </>
          )}
        </Box>

        {/* RIGHT — amounts. Big + bold. Wraps to a new line on narrow screens. */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            alignItems: 'baseline',
            justifyContent: 'flex-end',
            textAlign: 'right',
          }}
        >
          <Box sx={{ fontSize: { xs: 16, sm: 18 }, fontWeight: 700, color: '#1F1F1F' }}>
            {requestedCap} {formatINR(request.totalAmount)}
          </Box>
          {hasDispatch && (
            <Box sx={{ fontSize: { xs: 16, sm: 18 }, fontWeight: 700, color: isShortAmount ? '#C62828' : '#1F1F1F' }}>
              · {dispatchedCap} {formatINR(dispatchedAmount)}
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  // Default 'card' variant — original layout (kept untouched).
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        border: '2px solid #1F1F1F',
        bgcolor: '#FFFFFF',
        maxWidth: 520,
        ml: 'auto',
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
