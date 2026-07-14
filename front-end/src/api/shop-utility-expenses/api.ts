import { apiClient } from '../client'
import type {
  ShopUtilityExpenseDto, CreateShopUtilityExpenseRequest, UpdateShopUtilityExpenseRequest,
} from './types'

export const shopUtilityExpensesApi = {
  list: (from?: string, to?: string) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return apiClient.get<ShopUtilityExpenseDto[]>(`/api/shop-utility-expenses${qs ? `?${qs}` : ''}`)
  },
  create: (req: CreateShopUtilityExpenseRequest) =>
    apiClient.post<ShopUtilityExpenseDto>('/api/shop-utility-expenses', req),
  update: (id: string, req: UpdateShopUtilityExpenseRequest) =>
    apiClient.put<ShopUtilityExpenseDto>(`/api/shop-utility-expenses/${id}`, req),
  remove: (id: string) => apiClient.delete<void>(`/api/shop-utility-expenses/${id}`),
}
