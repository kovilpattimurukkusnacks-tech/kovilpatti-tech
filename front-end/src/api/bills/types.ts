// Phase 4 — POS billing (minimal v1: issue + cancel, Cash/UPI, MRP pricing).

export type PaymentMode = 'Cash' | 'UPI'
/** A single tender's mode — includes Credit (feature #4). */
export type TenderMode = 'Cash' | 'UPI' | 'Credit'
/** Header summary label — 'Split' when a bill has more than one tender. */
export type PaymentSummary = 'Cash' | 'UPI' | 'Split' | 'Credit'
export type BillStatus = 'Issued' | 'Cancelled'
export type CancelReasonType = 'Mistake' | 'Duplicate' | 'CustomerRefused' | 'Other'

export interface CancelBillRequest {
  reasonType: CancelReasonType
  reasonNote?: string | null
}

/** Product row for the billing grid + scan lookup (fn_billing_products). */
export interface BillingProductDto {
  id: string
  code: string
  barcode: string | null
  name: string
  categoryName: string | null
  weightValue: number | null
  weightUnit: string | null
  mrp: number
  onHand: number
  /** 01-Aug-2026 (Phase 4c): when true, POS prompts for a weight instead of
   *  auto-adding 1 packet. Only meaningful with g/kg weightUnit + weightValue > 0. */
  soldLoose: boolean
}

/** Cart line — XOR: packet mode uses qty (int > 0), loose uses looseWeightG (g > 0). */
export interface BillLineRequest {
  productId: string
  qty?: number | null
  looseWeightG?: number | null
}

/** One tender (feature #5, split payment). Multiple must sum to the total. */
export interface BillPaymentRequest {
  mode: TenderMode
  amount: number
}

/** Bill-level discount input. Percent → value in 0-100, Amount → flat ₹.
 *  Both null when no discount. Actual ₹ applied is computed server-side. */
export type DiscountKind = 'Percent' | 'Amount'

export interface CreateBillRequest {
  payments: BillPaymentRequest[]
  items: BillLineRequest[]
  customerId?: string | null    // required when a payment is 'Credit'
  notes?: string | null
  discountKind?: DiscountKind | null
  discountValue?: number | null
}

export interface BillPaymentDto {
  id: string
  mode: TenderMode
  amount: number
}

export interface BillCreatedDto {
  id: string
  code: string
  totalItems: number
  totalQty: number
  subtotal: number
  discountAmount: number
  totalAmount: number
}

export interface BillListItemDto {
  id: string
  code: string
  status: BillStatus
  paymentMode: PaymentSummary
  totalItems: number
  totalQty: number
  subtotal: number
  discountAmount: number
  totalAmount: number
  createdAt: string
  createdByName: string | null
  cancelledAt: string | null
  cancelReasonType: CancelReasonType | null
  cancelReason: string | null
}

export interface BillItemDto {
  id: string
  productId: string
  productCode: string
  productName: string
  weightValue: number | null
  weightUnit: string | null
  /** Nullable — populated only for packet-mode lines. Loose lines set looseWeightG. */
  qty: number | null
  /** 01-Aug-2026 (Phase 4c): grams for loose-weight lines. */
  looseWeightG: number | null
  /** Pack weight in grams captured at sale time for loose lines. */
  packWeightGSnapshot: number | null
  unitPrice: number
  lineTotal: number
}

export interface BillDetailDto {
  id: string
  code: string
  status: BillStatus
  paymentMode: PaymentSummary
  totalItems: number
  totalQty: number
  subtotal: number
  discountKind: DiscountKind | null
  discountValue: number | null
  discountAmount: number
  totalAmount: number
  notes: string | null
  createdAt: string
  createdByName: string | null
  cancelledAt: string | null
  cancelledByName: string | null
  cancelReasonType: CancelReasonType | null
  cancelReason: string | null
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  items: BillItemDto[]
  payments: BillPaymentDto[]
}

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface BillListFilters {
  search?: string
  status?: BillStatus
  from?: string   // yyyy-MM-dd
  to?: string
  page?: number
  pageSize?: number
}

// ───────── Bill returns (feature #1) — Cash/UPI refund, partial + full ─────────

export type RefundMode = 'Cash' | 'UPI'
export type ReturnReasonType = 'Damaged' | 'WrongItem' | 'ChangedMind' | 'Other'

/** A source-bill line with how much of it can still be returned. */
export interface ReturnableItemDto {
  productId: string
  productCode: string
  productName: string
  weightValue: number | null
  weightUnit: string | null
  unitPrice: number
  billedQty: number
  returnedQty: number
  returnableQty: number
}

export interface ReturnLineRequest {
  productId: string
  qty: number
}

export interface CreateBillReturnRequest {
  sourceBillId: string
  refundMode: RefundMode
  reasonType: ReturnReasonType
  reasonNote?: string | null
  items: ReturnLineRequest[]
}

export interface BillReturnCreatedDto {
  id: string
  code: string
  totalItems: number
  totalQty: number
  totalAmount: number
}

export interface BillReturnListItemDto {
  id: string
  code: string
  sourceBillId: string
  sourceBillCode: string
  refundMode: RefundMode
  reasonType: ReturnReasonType
  reasonNote: string | null
  totalItems: number
  totalQty: number
  totalAmount: number
  createdAt: string
  createdByName: string | null
}

export interface BillReturnItemDto {
  id: string
  productId: string
  productCode: string
  productName: string
  weightValue: number | null
  weightUnit: string | null
  qty: number
  unitPrice: number
  lineTotal: number
}

export interface BillReturnDetailDto {
  id: string
  code: string
  sourceBillId: string
  sourceBillCode: string
  refundMode: RefundMode
  reasonType: ReturnReasonType
  reasonNote: string | null
  totalItems: number
  totalQty: number
  totalAmount: number
  createdAt: string
  createdByName: string | null
  items: BillReturnItemDto[]
}

export interface BillReturnListFilters {
  search?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

// ───────── Held (draft) bills (feature #3) ─────────

export interface CreateHoldRequest {
  customerId?: string | null
  label?: string | null
  note?: string | null
  items: BillLineRequest[]
}

export interface HeldBillCreatedDto {
  id: string
}

export interface HeldBillListItemDto {
  id: string
  label: string | null
  note: string | null
  customerName: string | null
  itemCount: number
  totalQty: number
  totalAmount: number
  createdAt: string
}

/** Item carrying CURRENT product data so the POS rebuilds a cart line. */
export interface HeldBillItemDto {
  productId: string
  code: string
  barcode: string | null
  name: string
  weightValue: number | null
  weightUnit: string | null
  mrp: number
  onHand: number
  qty: number
}

export interface HeldBillDetailDto {
  id: string
  customerId: string | null
  label: string | null
  note: string | null
  items: HeldBillItemDto[]
}
