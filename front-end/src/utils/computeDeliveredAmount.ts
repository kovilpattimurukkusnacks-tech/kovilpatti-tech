// Shared by the A4 picklist and the thermal receipt — both need the
// "delivered amount" computed client-side so it always matches the items
// table (totalDispatchedAmount on the DTO is null until dispatch happens).
// Effective qty = dispatchedQty when set (post-dispatch), else requestedQty
// (pre-dispatch).

export type DeliveredAmountItem = {
  dispatchedQty: number | null
  requestedQty: number
  unitPrice: number
}

export function computeDeliveredAmount(items: DeliveredAmountItem[] | null | undefined): number {
  return (items ?? []).reduce(
    (sum, it) => sum + (it.dispatchedQty ?? it.requestedQty) * it.unitPrice,
    0,
  )
}
