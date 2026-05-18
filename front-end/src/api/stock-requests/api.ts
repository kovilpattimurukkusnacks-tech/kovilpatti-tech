import { apiClient } from '../client'
import type {
  StockRequestDto, CreateStockRequestRequest, UpdateStockRequestRequest,
  RejectRequest, DispatchRequest, StockRequestListFilters, PagedResult,
  CumulativePendingLine, ShopRequestCount, RequestStatus,
} from './types'

function toQuery(filters?: StockRequestListFilters): string {
  if (!filters) return ''
  const p = new URLSearchParams()
  if (filters.shopId)        p.set('shopId', filters.shopId)
  if (filters.inventoryId)   p.set('inventoryId', filters.inventoryId)
  if (filters.status)        p.set('status', filters.status)
  if (filters.search)        p.set('search', filters.search)
  if (filters.page != null)     p.set('page', String(filters.page))
  if (filters.pageSize != null) p.set('pageSize', String(filters.pageSize))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const stockRequestsApi = {
  // Admin — all requests
  listAll:      (f?: StockRequestListFilters)      => apiClient.get<PagedResult<StockRequestDto>>(`/api/stock-requests${toQuery(f)}`),

  // Shop user — own shop's requests
  listMine:     (f?: StockRequestListFilters)      => apiClient.get<PagedResult<StockRequestDto>>(`/api/stock-requests/mine${toQuery(f)}`),

  // Inventory user — incoming for own godown
  listIncoming: (f?: StockRequestListFilters)      => apiClient.get<PagedResult<StockRequestDto>>(`/api/stock-requests/incoming${toQuery(f)}`),

  // Cumulative-pending workload report (Inventory + Admin)
  cumulative:   (inventoryId?: string)             =>
    apiClient.get<CumulativePendingLine[]>(
      `/api/stock-requests/print/cumulative${inventoryId ? `?inventoryId=${inventoryId}` : ''}`,
    ),

  // Per-shop request count for the active status filter (Inventory + Admin).
  // Drives the shop quick-filter chips below the status presets.
  countByShop: (args?: { status?: RequestStatus; inventoryId?: string }) => {
    const p = new URLSearchParams()
    if (args?.status)      p.set('status', args.status)
    if (args?.inventoryId) p.set('inventoryId', args.inventoryId)
    const qs = p.toString()
    return apiClient.get<ShopRequestCount[]>(`/api/stock-requests/count-by-shop${qs ? `?${qs}` : ''}`)
  },

  // Detail (any role; BE enforces ownership)
  get:          (id: string)                       => apiClient.get<StockRequestDto>(`/api/stock-requests/${id}`),

  // Mutations
  create:   (req: CreateStockRequestRequest)               => apiClient.post<StockRequestDto>('/api/stock-requests', req),
  update:   (id: string, req: UpdateStockRequestRequest)   => apiClient.put<StockRequestDto>(`/api/stock-requests/${id}`, req),
  approve:  (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/approve`),
  reject:   (id: string, req: RejectRequest)               => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/reject`, req),
  revoke:   (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/revoke`),
  dispatch: (id: string, req: DispatchRequest)             => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/dispatch`, req),
  receive:  (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/receive`),
  cancel:   (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/cancel`),
}
