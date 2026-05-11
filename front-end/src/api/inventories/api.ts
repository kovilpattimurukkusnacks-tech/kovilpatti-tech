import { apiClient } from '../client'
import type {
  InventoryDto, CreateInventoryRequest, UpdateInventoryRequest, PagedResult,
} from './types'

export const inventoriesApi = {
  list:      ()                                         => apiClient.get<InventoryDto[]>('/api/inventories'),
  listPaged: (page: number, pageSize: number)           => apiClient.get<PagedResult<InventoryDto>>(`/api/inventories/paged?page=${page}&pageSize=${pageSize}`),
  get:       (id: string)                               => apiClient.get<InventoryDto>(`/api/inventories/${id}`),
  create:    (req: CreateInventoryRequest)              => apiClient.post<InventoryDto>('/api/inventories', req),
  update:    (id: string, req: UpdateInventoryRequest)  => apiClient.put<InventoryDto>(`/api/inventories/${id}`, req),
  remove:    (id: string)                               => apiClient.delete<void>(`/api/inventories/${id}`),
}
