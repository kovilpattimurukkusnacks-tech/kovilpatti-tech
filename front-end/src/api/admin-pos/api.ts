import { apiClient } from '../client'
import type { PagedResult } from '../bills/types'
import type {
  AdminBillDetailDto, AdminBillFilters, AdminBillListItemDto,
  AdminBillReturnDetailDto, AdminBillReturnListItemDto, AdminCustomerFilters, AdminCustomerPageDto,
  AdminDateRange, AdminEodDenominationDto, AdminEodFilters, AdminEodSessionDto, AdminReturnFilters,
  AdminSalesDayRowDto, AdminSalesProductRowDto, AdminSalesShopRowDto, AdminSalesSummaryDto,
  CustomerLedgerEntryDto,
} from './types'
import type {
  BillReturnCreatedDto, CancelBillRequest, CreateBillReturnRequest, RefundOptionDto, ReturnableItemDto,
} from '../bills/types'
import type { CustomerDto } from '../customers/types'

function q(params: object): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

const BASE = '/api/admin/pos'

/** Phase 4d — admin POS views (Admin only, all shops). 25-Sep-2026: plus the
 *  overrides — cancel any bill, late returns, credit limits. */
export const adminPosApi = {
  bills: (f: AdminBillFilters) =>
    apiClient.get<PagedResult<AdminBillListItemDto>>(`${BASE}/bills${q(f)}`),
  bill: (id: string) =>
    apiClient.get<AdminBillDetailDto>(`${BASE}/bills/${id}`),

  cancelBill: (id: string, req: CancelBillRequest) =>
    apiClient.post<void>(`${BASE}/bills/${id}/cancel`, req),
  returnableItems: (billId: string) =>
    apiClient.get<ReturnableItemDto[]>(`${BASE}/bills/${billId}/returnable`),
  refundOptions: (billId: string) =>
    apiClient.get<RefundOptionDto[]>(`${BASE}/bills/${billId}/refund-options`),
  createReturn: (req: CreateBillReturnRequest) =>
    apiClient.post<BillReturnCreatedDto>(`${BASE}/returns`, req),
  setCreditLimit: (customerId: string, creditLimit: number) =>
    apiClient.patch<CustomerDto>(`${BASE}/customers/${customerId}/credit-limit`, { creditLimit }),

  returns: (f: AdminReturnFilters) =>
    apiClient.get<PagedResult<AdminBillReturnListItemDto>>(`${BASE}/returns${q(f)}`),
  returnDetail: (id: string) =>
    apiClient.get<AdminBillReturnDetailDto>(`${BASE}/returns/${id}`),

  eod: (f: AdminEodFilters) =>
    apiClient.get<PagedResult<AdminEodSessionDto>>(`${BASE}/eod${q(f)}`),
  eodDenominations: (sessionId: string) =>
    apiClient.get<AdminEodDenominationDto[]>(`${BASE}/eod/${sessionId}/denominations`),

  customers: (f: AdminCustomerFilters) =>
    apiClient.get<AdminCustomerPageDto>(`${BASE}/customers${q(f)}`),
  customerLedger: (id: string, page = 1, pageSize = 20) =>
    apiClient.get<PagedResult<CustomerLedgerEntryDto>>(`${BASE}/customers/${id}/ledger${q({ page, pageSize })}`),

  salesSummary: (r: AdminDateRange) =>
    apiClient.get<AdminSalesSummaryDto>(`${BASE}/sales/summary${q(r)}`),
  salesByShop: (r: Omit<AdminDateRange, 'shopId'>) =>
    apiClient.get<AdminSalesShopRowDto[]>(`${BASE}/sales/by-shop${q(r)}`),
  salesDaily: (r: AdminDateRange) =>
    apiClient.get<AdminSalesDayRowDto[]>(`${BASE}/sales/daily${q(r)}`),
  salesTopProducts: (r: AdminDateRange, limit = 20) =>
    apiClient.get<AdminSalesProductRowDto[]>(`${BASE}/sales/top-products${q({ ...r, limit })}`),
}
