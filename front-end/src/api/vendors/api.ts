import { apiClient } from '../client'
import type { VendorDto, CreateVendorRequest, UpdateVendorRequest, PagedResult } from './types'

export type VendorListFilters = {
  search?: string
  active?: boolean
  page?: number
  pageSize?: number
}

function toQuery(filters?: VendorListFilters): string {
  if (!filters) return ''
  const p = new URLSearchParams()
  if (filters.search)        p.set('search', filters.search)
  if (filters.active != null) p.set('active', String(filters.active))
  if (filters.page != null)     p.set('page', String(filters.page))
  if (filters.pageSize != null) p.set('pageSize', String(filters.pageSize))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const vendorsApi = {
  list:      ()                                     => apiClient.get<VendorDto[]>('/api/vendors'),
  listPaged: (filters?: VendorListFilters)          => apiClient.get<PagedResult<VendorDto>>(`/api/vendors/paged${toQuery(filters)}`),
  get:       (id: string)                           => apiClient.get<VendorDto>(`/api/vendors/${id}`),
  create:    (req: CreateVendorRequest)             => apiClient.post<VendorDto>('/api/vendors', req),
  update:    (id: string, req: UpdateVendorRequest) => apiClient.put<VendorDto>(`/api/vendors/${id}`, req),
  remove:    (id: string)                           => apiClient.delete<void>(`/api/vendors/${id}`),
}
