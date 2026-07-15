import { apiClient } from '../client'
import type {
  BillingProductDto, CreateBillRequest, BillCreatedDto,
  BillListItemDto, BillDetailDto, BillListFilters, PagedResult,
} from './types'

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

export const billsApi = {
  // Product grid + scan lookup source. Server scopes to the caller's shop.
  products: (search?: string) =>
    apiClient.get<BillingProductDto[]>(
      `/api/bills/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  create: (req: CreateBillRequest) => apiClient.post<BillCreatedDto>('/api/bills', req),

  list: (f?: BillListFilters) =>
    apiClient.get<PagedResult<BillListItemDto>>(`/api/bills${toQuery(f)}`),

  get: (id: string) => apiClient.get<BillDetailDto>(`/api/bills/${id}`),

  cancel: (id: string, reason: string) =>
    apiClient.post<void>(`/api/bills/${id}/cancel`, { reason }),
}
