import { apiClient } from '../client'
import type {
  BillingProductDto, CreateBillRequest, BillCreatedDto,
  BillListItemDto, BillDetailDto, BillListFilters, PagedResult, CancelBillRequest,
  ReturnableItemDto, CreateBillReturnRequest, BillReturnCreatedDto,
  BillReturnListItemDto, BillReturnDetailDto, BillReturnListFilters,
  CreateHoldRequest, HeldBillCreatedDto, HeldBillListItemDto, HeldBillDetailDto,
} from './types'

type CreateCancelBody = CancelBillRequest

function toQuery(f?: BillListFilters): string {
  if (!f) return ''
  const p = new URLSearchParams()
  if (f.search)           p.set('search', f.search)
  if (f.status)           p.set('status', f.status)
  if (f.from)             p.set('from', f.from)
  if (f.to)               p.set('to', f.to)
  if (f.page != null)     p.set('page', String(f.page))
  if (f.pageSize != null) p.set('pageSize', String(f.pageSize))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

function toReturnQuery(f?: BillReturnListFilters): string {
  if (!f) return ''
  const p = new URLSearchParams()
  if (f.search)           p.set('search', f.search)
  if (f.from)             p.set('from', f.from)
  if (f.to)               p.set('to', f.to)
  if (f.page != null)     p.set('page', String(f.page))
  if (f.pageSize != null) p.set('pageSize', String(f.pageSize))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const billsApi = {
  // Product grid + scan lookup source. Server scopes to the caller's shop.
  products: (search?: string) =>
    apiClient.get<BillingProductDto[]>(
      `/api/bills/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  create: (req: CreateBillRequest) => apiClient.post<BillCreatedDto>('/api/bills', req),

  list: (f?: BillListFilters) =>
    apiClient.get<PagedResult<BillListItemDto>>(`/api/bills${toQuery(f)}`),

  get: (id: string) => apiClient.get<BillDetailDto>(`/api/bills/${id}`),

  cancel: (id: string, req: CreateCancelBody) =>
    apiClient.post<void>(`/api/bills/${id}/cancel`, req),

  // ── Returns (feature #1) ──
  returnableItems: (billId: string) =>
    apiClient.get<ReturnableItemDto[]>(`/api/bills/${billId}/returnable`),

  createReturn: (req: CreateBillReturnRequest) =>
    apiClient.post<BillReturnCreatedDto>('/api/bills/returns', req),

  listReturns: (f?: BillReturnListFilters) =>
    apiClient.get<PagedResult<BillReturnListItemDto>>(`/api/bills/returns${toReturnQuery(f)}`),

  getReturn: (id: string) => apiClient.get<BillReturnDetailDto>(`/api/bills/returns/${id}`),

  // ── Held / draft bills (feature #3) ──
  holdCreate: (req: CreateHoldRequest) => apiClient.post<HeldBillCreatedDto>('/api/bills/holds', req),
  holdList: () => apiClient.get<HeldBillListItemDto[]>('/api/bills/holds'),
  holdGet: (id: string) => apiClient.get<HeldBillDetailDto>(`/api/bills/holds/${id}`),
  holdDelete: (id: string) => apiClient.delete<void>(`/api/bills/holds/${id}`),
}
