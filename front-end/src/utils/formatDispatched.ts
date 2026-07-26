/**
 * Dispatch / receive display formatters for stock-request line items.
 *
 * A line dispatches in one of two modes (mutually exclusive on the BE):
 *
 *   • Packet count  → dispatchedQty is set          e.g. "3 packets"
 *   • Partial weight → dispatchedWeightG is set     e.g. "3.5 kg" or "500 g"
 *
 * Same rule for the receive side (receivedQty / receivedWeightG).
 *
 * Every list + detail screen goes through these helpers so the same string
 * shows everywhere. When a line uses partial-weight mode the packet count
 * is deliberately NOT rendered — it would be double-counting.
 *
 * 25-Jul-2026 — introduced with the Order-side partial-weight dispatch
 * feature. Return-side partial (returnWeightG) has its own display path
 * on the Return dialog and isn't handled here.
 */

const kgFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

/** Format a grams value as a scale-appropriate string: ≥ 1000 g → "1.5 kg",
 *  < 1000 g → "500 g". No trailing zeros ("1.5 kg", not "1.500 kg"). */
export function formatWeightG(weightG: number): string {
  if (weightG >= 1000) {
    const kg = weightG / 1000
    return `${kgFormatter.format(kg)} kg`
  }
  return `${kgFormatter.format(weightG)} g`
}

/** Format a packet count with pluralised unit: "3 packets", "1 packet". */
export function formatPackets(qty: number): string {
  return `${qty} ${qty === 1 ? 'packet' : 'packets'}`
}

type DispatchDisplayLine = {
  dispatchedQty:      number | null
  dispatchedWeightG?: number | null
}

/** "3 packets" for packet-count dispatch, "3.5 kg" for partial-weight, or
 *  "—" when the line hasn't been dispatched yet (both fields null). */
export function formatDispatched(line: DispatchDisplayLine): string {
  if (line.dispatchedWeightG != null && line.dispatchedWeightG > 0) {
    return formatWeightG(line.dispatchedWeightG)
  }
  if (line.dispatchedQty != null) {
    return formatPackets(line.dispatchedQty)
  }
  return '—'
}

type ReceivedDisplayLine = {
  receivedQty:      number | null
  receivedWeightG?: number | null
  dispatchedQty:      number | null
  dispatchedWeightG?: number | null
}

/** Same shape as formatDispatched but reads the received leg first, falls
 *  back to the dispatched leg (i.e. "shop reported no mismatch → same as
 *  dispatched"). */
export function formatReceived(line: ReceivedDisplayLine): string {
  if (line.receivedWeightG != null && line.receivedWeightG > 0) {
    return formatWeightG(line.receivedWeightG)
  }
  if (line.receivedQty != null) {
    return formatPackets(line.receivedQty)
  }
  return formatDispatched(line)
}

/** True when the line has ANY partial-weight component (dispatch or receive).
 *  Screens use this to enable the partial-weight input row / decoration. */
export function isPartialWeightLine(line: {
  dispatchedWeightG?: number | null
  receivedWeightG?:   number | null
}): boolean {
  return (line.dispatchedWeightG != null && line.dispatchedWeightG > 0)
      || (line.receivedWeightG   != null && line.receivedWeightG   > 0)
}

/** True when the product supports partial-weight input at all — only g/kg
 *  SKUs qualify. The inventory dispatch UI hides the Full/Partial toggle
 *  entirely when this is false. */
export function isWeightUnit(unit: string | null | undefined): boolean {
  return unit === 'g' || unit === 'kg'
}

/** Convert a product's pack size to grams. Returns null when weight fields
 *  aren't set — callers should treat null as "no partial-weight capability
 *  on this line". */
export function packSizeInGrams(
  weightValue: number | null | undefined,
  weightUnit:  string | null | undefined,
): number | null {
  if (weightValue == null || weightValue <= 0 || !isWeightUnit(weightUnit)) {
    return null
  }
  return weightUnit === 'kg' ? weightValue * 1000 : weightValue
}
