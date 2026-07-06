/**
 * Renders the shop-declared receipt-discrepancy total for a request row.
 * Value semantics (from fn_request_list_paged.total_adjustment_qty):
 *
 *   • null → no discrepancy at all (received = dispatched on every line, or
 *            not yet Received). Dim dash.
 *   • 0    → shop reported discrepancies but they net to zero (rare —
 *            one line over, another line short). Plain "0".
 *   • > 0  → over-received. Amber "+N".
 *   • < 0  → short-received. Red "N" (already negative signed).
 *
 * Consumed by ShopRequests / InventoryRequests / AdminRequests DataGrids
 * as a shared "Adjustment Qty" column. 03-Jul-2026.
 */
export function AdjustmentQtyCell({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <span className="text-[#1F1F1F]/40">—</span>
  }
  if (value === 0) return <span>0</span>
  if (value < 0) return <span style={{ color: '#C62828', fontWeight: 700 }}>{value}</span>
  return <span style={{ color: '#E65100', fontWeight: 700 }}>+{value}</span>
}
