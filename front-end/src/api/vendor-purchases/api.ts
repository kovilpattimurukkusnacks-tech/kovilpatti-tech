import { apiClient } from '../client'
import type {
  VendorPurchaseDto, CreateVendorPurchaseRequest, UpdateVendorPurchaseRequest,
  VendorPurchaseListFilters, PagedResult,
} from './types'

function toQuery(filters?: VendorPurchaseListFilters): string {
  if (!filters) return ''
  const p = new URLSearchParams()
  if (filters.vendorId)      p.set('vendorId', filters.vendorId)
  if (filters.godownId)      p.set('godownId', filters.godownId)
  if (filters.status)        p.set('status', filters.status)
  if (filters.isInterstate != null) p.set('isInterstate', String(filters.isInterstate))
  if (filters.fromDate)      p.set('fromDate', filters.fromDate)
  if (filters.toDate)        p.set('toDate', filters.toDate)
  if (filters.search)        p.set('search', filters.search)
  if (filters.page != null)     p.set('page', String(filters.page))
  if (filters.pageSize != null) p.set('pageSize', String(filters.pageSize))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const vendorPurchasesApi = {
  list:    (f?: VendorPurchaseListFilters)             => apiClient.get<PagedResult<VendorPurchaseDto>>(`/api/vendor-purchases${toQuery(f)}`),
  get:     (id: string)                                => apiClient.get<VendorPurchaseDto>(`/api/vendor-purchases/${id}`),
  create:  (req: CreateVendorPurchaseRequest)          => apiClient.post<VendorPurchaseDto>('/api/vendor-purchases', req),
  update:  (id: string, req: UpdateVendorPurchaseRequest) => apiClient.put<VendorPurchaseDto>(`/api/vendor-purchases/${id}`, req),
  receive: (id: string)                                => apiClient.patch<VendorPurchaseDto>(`/api/vendor-purchases/${id}/receive`),
  cancel:  (id: string)                                => apiClient.delete<void>(`/api/vendor-purchases/${id}`),
}
