import { apiClient } from '../client'
import type { ShopDto, CreateShopRequest, UpdateShopRequest, PagedResult } from './types'

export const shopsApi = {
  list:      ()                                    => apiClient.get<ShopDto[]>('/api/shops'),
  listPaged: (page: number, pageSize: number)      => apiClient.get<PagedResult<ShopDto>>(`/api/shops/paged?page=${page}&pageSize=${pageSize}`),
  get:       (id: string)                          => apiClient.get<ShopDto>(`/api/shops/${id}`),
  create:    (req: CreateShopRequest)              => apiClient.post<ShopDto>('/api/shops', req),
  update:    (id: string, req: UpdateShopRequest)  => apiClient.put<ShopDto>(`/api/shops/${id}`, req),
  remove:    (id: string)                          => apiClient.delete<void>(`/api/shops/${id}`),
}
