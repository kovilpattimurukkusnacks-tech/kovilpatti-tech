import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { shopInventoryApi } from '../api/shop-inventory/api'
import type {
  AdjustInventoryRequest,
  ShopInventoryListFilters,
  ShopInventoryMovementFilters,
} from '../api/shop-inventory/types'

/**
 * Query-key registry — kept centralised so cache invalidations after
 * mutations touch every dependent query in one place. Anytime a new
 * read hook is added, add its key here too.
 */
export const shopInventoryKeys = {
  all:            ['shop-inventory'] as const,
  dashboard:      (shopId?: string) => ['shop-inventory', 'dashboard', shopId ?? 'self'] as const,
  list:           (f?: ShopInventoryListFilters) => ['shop-inventory', 'list', f ?? {}] as const,
  detail:         (productId: string, shopId?: string) =>
    ['shop-inventory', 'detail', shopId ?? 'self', productId] as const,
  lowStock:       (threshold: number, shopId?: string) =>
    ['shop-inventory', 'low-stock', shopId ?? 'self', threshold] as const,
  valuation:      (shopId?: string) => ['shop-inventory', 'valuation', shopId ?? 'self'] as const,
  tree:           (shopId?: string) => ['shop-inventory', 'tree', shopId ?? 'self'] as const,
  productMovements: (productId: string, f?: ShopInventoryMovementFilters) =>
    ['shop-inventory', 'movements', productId, f ?? {}] as const,
  movements:      (f?: ShopInventoryMovementFilters) =>
    ['shop-inventory', 'movements', 'all', f ?? {}] as const,
}

// ═══════════════ Dashboard ═══════════════

/**
 * Aggregate dashboard payload — one call for every widget on /shop/dashboard.
 * ShopUser omits shopId; Admin passes the target shop.
 */
export function useShopDashboard(shopId?: string) {
  return useQuery({
    queryKey: shopInventoryKeys.dashboard(shopId),
    queryFn:  () => shopInventoryApi.dashboard(shopId),
    // Refresh on window focus — shopkeepers often leave the tab open all
    // day and expect the numbers to be current when they return.
    refetchOnWindowFocus: true,
    // 60s stale time avoids hammering the API on every hover/click while
    // still giving a fresh number on the next tab focus after a minute.
    staleTime: 60_000,
  })
}

// ═══════════════ On-hand list + detail ═══════════════

export function useShopInventoryList(filters?: ShopInventoryListFilters) {
  return useQuery({
    queryKey: shopInventoryKeys.list(filters),
    queryFn:  () => shopInventoryApi.list(filters),
    // Keep the previous page visible while paging — no flicker to empty state.
    placeholderData: keepPreviousData,
  })
}

export function useShopInventoryDetail(productId: string | undefined, shopId?: string) {
  return useQuery({
    queryKey: productId ? shopInventoryKeys.detail(productId, shopId) : ['shop-inventory', 'idle'],
    queryFn:  () => shopInventoryApi.get(productId!, shopId),
    enabled:  !!productId,
  })
}

export function useShopInventoryLowStock(threshold = 5, shopId?: string) {
  return useQuery({
    queryKey: shopInventoryKeys.lowStock(threshold, shopId),
    queryFn:  () => shopInventoryApi.lowStock(threshold, shopId),
  })
}

export function useShopInventoryValuation(shopId?: string) {
  return useQuery({
    queryKey: shopInventoryKeys.valuation(shopId),
    queryFn:  () => shopInventoryApi.valuation(shopId),
  })
}

/**
 * Flat list of every (product, category_id, on_hand) for the dashboard's
 * category-tree browse view. Combined with `useCategories()` client-side
 * to build the expandable tree with rolled-up qty per node.
 */
export function useShopInventoryTree(shopId?: string) {
  return useQuery({
    queryKey: shopInventoryKeys.tree(shopId),
    queryFn:  () => shopInventoryApi.tree(shopId),
    // Same 60s stale as the dashboard aggregate — they refresh together
    // on window focus so numbers stay in sync between widgets.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })
}

// ═══════════════ Movements ═══════════════

export function useShopInventoryProductMovements(
  productId: string | undefined,
  filters?: ShopInventoryMovementFilters,
) {
  return useQuery({
    queryKey: productId
      ? shopInventoryKeys.productMovements(productId, filters)
      : ['shop-inventory', 'movements', 'idle'],
    queryFn: () => shopInventoryApi.productMovements(productId!, filters),
    enabled: !!productId,
  })
}

export function useShopInventoryMovements(filters?: ShopInventoryMovementFilters) {
  return useQuery({
    queryKey: shopInventoryKeys.movements(filters),
    queryFn:  () => shopInventoryApi.movements(filters),
  })
}

// ═══════════════ Manual adjustment (Admin only) ═══════════════

/**
 * Admin manual write-off / correction. Invalidates every read that could
 * be affected — dashboard, on-hand list, product detail, low-stock,
 * valuation, and movements.
 */
export function useAdjustInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ req, shopId }: { req: AdjustInventoryRequest; shopId: string }) =>
      shopInventoryApi.adjust(req, shopId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shopInventoryKeys.all })
    },
  })
}

