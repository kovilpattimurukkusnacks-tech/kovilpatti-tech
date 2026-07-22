import { apiClient } from '../client'
import type {
  InventoryExpenseDto, CreateInventoryExpenseRequest, UpdateInventoryExpenseRequest,
} from './types'

export const inventoryExpensesApi = {
  list: (from?: string, to?: string) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return apiClient.get<InventoryExpenseDto[]>(`/api/inventory-expenses${qs ? `?${qs}` : ''}`)
  },
  create: (req: CreateInventoryExpenseRequest) =>
    apiClient.post<InventoryExpenseDto>('/api/inventory-expenses', req),
  update: (id: string, req: UpdateInventoryExpenseRequest) =>
    apiClient.put<InventoryExpenseDto>(`/api/inventory-expenses/${id}`, req),
  remove: (id: string) => apiClient.delete<void>(`/api/inventory-expenses/${id}`),
}
