import { apiClient } from '../client'
import type {
  InventoryDto, CreateInventoryRequest, UpdateInventoryRequest,
} from './types'

export const inventoriesApi = {
  list:   ()                                            => apiClient.get<InventoryDto[]>('/api/inventories'),
  get:    (id: string)                                  => apiClient.get<InventoryDto>(`/api/inventories/${id}`),
  create: (req: CreateInventoryRequest)                 => apiClient.post<InventoryDto>('/api/inventories', req),
  update: (id: string, req: UpdateInventoryRequest)     => apiClient.put<InventoryDto>(`/api/inventories/${id}`, req),
  remove: (id: string)                                  => apiClient.delete<void>(`/api/inventories/${id}`),
}
