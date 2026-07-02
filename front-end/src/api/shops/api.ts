import { apiClient } from '../client'
import type { PagedResult } from '../types'
import type { ShopDto, CreateShopRequest, UpdateShopRequest } from './types'

export const shopsApi = {
  list:           ()                                    => apiClient.get<ShopDto[]>('/api/shops'),
  listPaged:      (page: number, pageSize: number)      => apiClient.get<PagedResult<ShopDto>>(`/api/shops/paged?page=${page}&pageSize=${pageSize}`),
  get:            (id: string)                          => apiClient.get<ShopDto>(`/api/shops/${id}`),
  create:         (req: CreateShopRequest)              => apiClient.post<ShopDto>('/api/shops', req),
  update:         (id: string, req: UpdateShopRequest)  => apiClient.put<ShopDto>(`/api/shops/${id}`, req),
  /** Fast-path single-column toggle for the AdminSettings per-shop GST list. */
  setGstEnabled:  (id: string, enabled: boolean)        => apiClient.patch<ShopDto>(`/api/shops/${id}/gst-enabled`, { enabled }),
  remove:         (id: string)                          => apiClient.delete<void>(`/api/shops/${id}`),
}
