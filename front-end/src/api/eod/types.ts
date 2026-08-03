// Phase 4c — end-of-day close-out. Mirrors BE EodDtos.

export type IsoDateTime = string    // ISO 8601 with offset

export interface EodExpectedDto {
  windowFrom: IsoDateTime
  windowTo: IsoDateTime
  cashSales: number
  upiSales: number
  creditSales: number
  cashRefunds: number
  upiRefunds: number
  cancelCashBack: number
  /** cashSales − cashRefunds − cancelCashBack (₹ that should be in the till). */
  expectedCash: number
  billCount: number
  returnCount: number
  cancelCount: number
}

export interface EodDenominationInput {
  denomination: number  // one of 500 / 200 / 100 / 50 / 20 / 10 / 5 / 2 / 1
  count: number         // ≥ 0
}

export interface EodCloseRequest {
  windowFrom: IsoDateTime
  windowTo: IsoDateTime
  denominations: EodDenominationInput[]
  notes?: string | null
}

export interface EodSessionListItemDto {
  id: string
  windowFrom: IsoDateTime
  closedAt: IsoDateTime
  closedByName: string | null
  cashSales: number
  upiSales: number
  creditSales: number
  cashRefunds: number
  upiRefunds: number
  cancelCashBack: number
  expectedCash: number
  physicalCash: number
  variance: number
  notes: string | null
}

/** Fixed order used across all EOD UI — biggest to smallest. */
export const DENOMINATIONS: readonly number[] = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const
