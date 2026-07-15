// Phase 4 — POS billing (minimal v1: issue + cancel, Cash/UPI, MRP pricing).

export type PaymentMode = 'Cash' | 'UPI'
export type BillStatus = 'Issued' | 'Cancelled'

/** Product row for the billing grid + scan lookup (fn_billing_products). */
export interface BillingProductDto {
  id: string
  code: string
  barcode: string | null
  name: string
  weightValue: number | null
  weightUnit: string | null
  mrp: number
  onHand: number
}

export interface BillLineRequest {
  productId: string
  qty: number
}

export interface CreateBillRequest {
  paymentMode: PaymentMode
  items: BillLineRequest[]
  notes?: string | null
}

export interface BillCreatedDto {
  id: string
  code: string
  totalItems: number
  totalQty: number
  totalAmount: number
}

export interface BillListItemDto {
  id: string
  code: string
  status: BillStatus
  paymentMode: PaymentMode
  totalItems: number
  totalQty: number
  totalAmount: number
  createdAt: string
  createdByName: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface BillItemDto {
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

export interface BillDetailDto {
  id: string
  code: string
  status: BillStatus
  paymentMode: PaymentMode
  totalItems: number
  totalQty: number
  totalAmount: number
  notes: string | null
  createdAt: string
  createdByName: string | null
  cancelledAt: string | null
  cancelledByName: string | null
  cancelReason: string | null
  items: BillItemDto[]
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
