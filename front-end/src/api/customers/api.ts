import { apiClient } from '../client'
import type {
  CustomerDto, CreateCustomerRequest, SettleCreditRequest,
  CustomerLedgerEntryDto, CustomerListFilters, PagedResult,
} from './types'

function toQuery(f?: CustomerListFilters): string {
  if (!f) return ''
  const p = new URLSearchParams()
  if (f.search)           p.set('search', f.search)
  if (f.page != null)     p.set('page', String(f.page))
  if (f.pageSize != null) p.set('pageSize', String(f.pageSize))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const customersApi = {
  // 200 with null body when the phone isn't on file.
  lookup: (phone: string) =>
    apiClient.get<CustomerDto | null>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`),

  create: (req: CreateCustomerRequest) => apiClient.post<CustomerDto>('/api/customers', req),

  list: (f?: CustomerListFilters) =>
    apiClient.get<PagedResult<CustomerDto>>(`/api/customers${toQuery(f)}`),

  settle: (id: string, req: SettleCreditRequest) =>
    apiClient.post<number>(`/api/customers/${id}/settle`, req),

  ledger: (id: string, page = 1, pageSize = 20) =>
    apiClient.get<PagedResult<CustomerLedgerEntryDto>>(
      `/api/customers/${id}/ledger?page=${page}&pageSize=${pageSize}`),
}
