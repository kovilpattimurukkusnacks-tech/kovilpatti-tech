import { apiClient } from '../client'
import type { PagedResult } from '../stock-requests/types'
import type {
  AdjustInventoryRequest,
  CancelStockTakeRequest,
  ShopDashboardDto,
  ShopInventoryDetailDto,
  ShopInventoryListFilters,
  ShopInventoryLowStockDto,
  ShopInventoryMovementDto,
  ShopInventoryMovementFilters,
  ShopInventoryRowDto,
  StockTakeDetailDto,
  StockTakeListFilters,
  StockTakeSummaryDto,
  UpsertStockTakeLineRequest,
} from './types'

function q(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const shopInventoryApi = {
  // ── Dashboard aggregate ──
  dashboard: (shopId?: string) =>
    apiClient.get<ShopDashboardDto>(`/api/shop-dashboard${q({ shopId })}`),

  // ── Inventory reads ──
  list: (f?: ShopInventoryListFilters) =>
    apiClient.get<PagedResult<ShopInventoryRowDto>>(
      `/api/shop-inventory${q({ ...f })}`,
    ),

  get: (productId: string, shopId?: string) =>
    apiClient.get<ShopInventoryDetailDto>(
      `/api/shop-inventory/${productId}${q({ shopId })}`,
    ),

  lowStock: (threshold = 5, shopId?: string) =>
    apiClient.get<ShopInventoryLowStockDto[]>(
      `/api/shop-inventory/low-stock${q({ shopId, threshold })}`,
    ),

  valuation: (shopId?: string) =>
    apiClient.get<number>(`/api/shop-inventory/valuation${q({ shopId })}`),

  // Movements — either scoped to one product or across the whole shop
  productMovements: (productId: string, f?: ShopInventoryMovementFilters) =>
    apiClient.get<ShopInventoryMovementDto[]>(
      `/api/shop-inventory/${productId}/movements${q({ ...f })}`,
    ),

  movements: (f?: ShopInventoryMovementFilters) =>
    apiClient.get<ShopInventoryMovementDto[]>(
      `/api/shop-inventory/movements${q({ ...f })}`,
    ),

  // ── Admin-only manual adjustment ──
  adjust: (req: AdjustInventoryRequest, shopId: string) =>
    apiClient.post<ShopInventoryDetailDto>(
      `/api/shop-inventory/adjust${q({ shopId })}`,
      req,
    ),

  // ── Stock-take flow ──
  startStockTake: (shopId?: string) =>
    apiClient.post<StockTakeDetailDto>(
      `/api/shop-inventory/stock-takes${q({ shopId })}`,
      {},
    ),

  getStockTake: (id: string) =>
    apiClient.get<StockTakeDetailDto>(`/api/shop-inventory/stock-takes/${id}`),

  listStockTakes: (f?: StockTakeListFilters) =>
    apiClient.get<PagedResult<StockTakeSummaryDto>>(
      `/api/shop-inventory/stock-takes${q({ ...f })}`,
    ),

  upsertStockTakeLine: (id: string, req: UpsertStockTakeLineRequest) =>
    apiClient.put<StockTakeDetailDto>(
      `/api/shop-inventory/stock-takes/${id}/lines`,
      req,
    ),

  submitStockTake: (id: string) =>
    apiClient.post<StockTakeDetailDto>(
      `/api/shop-inventory/stock-takes/${id}/submit`,
      {},
    ),

  cancelStockTake: (id: string, req: CancelStockTakeRequest) =>
    apiClient.post<StockTakeDetailDto>(
      `/api/shop-inventory/stock-takes/${id}/cancel`,
      req,
    ),
}
