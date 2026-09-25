// Phase 4d (25-Sep-2026) — admin-side POS views. Client mirror of
// Backend/Business/DTOs/AdminPos/AdminPosDtos.cs (camelCase).
// Every list spans all shops unless shopId is passed.

import type {
  BillItemDto, BillPaymentDto, BillStatus, CancelReasonType, DiscountKind, PaymentSummary, TenderMode,
} from '../bills/types'
import type { CustomerLedgerEntryDto } from '../customers/types'

export type { CustomerLedgerEntryDto }

export interface AdminBillListItemDto {
  id: string
  code: string
  shopId: string
  shopCode: string
  shopName: string
  status: BillStatus
  paymentMode: PaymentSummary
  totalItems: number
  totalQty: number
  subtotal: number
  discountAmount: number
  totalAmount: number
  /** Σ of returns recorded against this bill (0 when none). */
  returnedAmount: number
  customerName: string | null
  customerPhone: string | null
  createdAt: string
  createdByName: string | null
  cancelledAt: string | null
  cancelledByName: string | null
  cancelReasonType: CancelReasonType | null
  cancelReason: string | null
}

export interface AdminBillReturnListItemDto {
  id: string
  code: string
  shopId: string
  shopCode: string
  shopName: string
  sourceBillId: string
  sourceBillCode: string
  refundMode: 'Cash' | 'UPI'
  reasonType: string
  reasonNote: string | null
  totalItems: number
  totalQty: number
  totalAmount: number
  createdAt: string
  createdByName: string | null
}

export interface AdminBillDetailDto {
  id: string
  code: string
  shopId: string
  shopCode: string
  shopName: string
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
  returns: AdminBillReturnListItemDto[]
}

export interface AdminBillReturnItemDto {
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

export interface AdminBillReturnDetailDto extends AdminBillReturnListItemDto {
  items: AdminBillReturnItemDto[]
}

export interface AdminEodSessionDto {
  id: string
  shopId: string
  shopCode: string
  shopName: string
  windowFrom: string
  closedAt: string
  closedByName: string | null
  cashSales: number
  upiSales: number
  creditSales: number
  cashRefunds: number
  upiRefunds: number
  cancelCashBack: number
  expectedCash: number
  physicalCash: number
  /** physical − expected. Negative = shortage. */
  variance: number
  notes: string | null
}

export interface AdminEodDenominationDto {
  denomination: number
  count: number
  amount: number
}

export interface AdminCustomerDto {
  id: string
  code: string
  shopId: string
  shopCode: string
  shopName: string
  name: string
  phone: string
  creditLimit: number
  creditBalance: number
  lastCreditAt: string | null
  lastSettlementAt: string | null
  createdAt: string
}

export interface AdminCustomerPageDto {
  items: AdminCustomerDto[]
  total: number
  page: number
  pageSize: number
  /** Outstanding across the whole filtered set, not just this page. */
  totalOutstanding: number
}

export interface AdminSalesSummaryDto {
  billCount: number
  grossSales: number
  discountTotal: number
  salesTotal: number
  avgBillValue: number
  cancelledCount: number
  cancelledAmount: number
  returnCount: number
  returnsTotal: number
  netSales: number
  cashSales: number
  upiSales: number
  creditSales: number
  cashRefunds: number
  upiRefunds: number
  settlementsCash: number
  settlementsUpi: number
}

export interface AdminSalesShopRowDto {
  shopId: string
  shopCode: string
  shopName: string
  billCount: number
  salesTotal: number
  discountTotal: number
  returnsTotal: number
  netSales: number
  cancelledCount: number
  cancelledAmount: number
  cashSales: number
  upiSales: number
  creditSales: number
}

export interface AdminSalesDayRowDto {
  day: string            // yyyy-MM-dd (IST)
  billCount: number
  salesTotal: number
  returnsTotal: number
  netSales: number
  cancelledCount: number
  cashSales: number
  upiSales: number
  creditSales: number
}

export interface AdminSalesProductRowDto {
  productId: string
  productCode: string
  productName: string
  categoryName: string | null
  packetsSold: number
  looseWeightG: number
  billCount: number
  revenue: number
}

// ── Filters ──

/** Shared by every report: IST dates yyyy-MM-dd, inclusive. */
export interface AdminDateRange {
  shopId?: string
  from: string
  to: string
}

export interface AdminBillFilters {
  shopId?: string
  search?: string
  status?: BillStatus
  paymentMode?: TenderMode
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export interface AdminReturnFilters {
  shopId?: string
  search?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export interface AdminEodFilters {
  shopId?: string
  from?: string
  to?: string
  varianceOnly?: boolean
  page?: number
  pageSize?: number
}

export interface AdminCustomerFilters {
  shopId?: string
  search?: string
  outstandingOnly?: boolean
  page?: number
  pageSize?: number
}
