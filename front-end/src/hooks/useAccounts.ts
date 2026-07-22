import { useQuery } from '@tanstack/react-query'
import { accountsApi } from '../api/accounts/api'
import type { AccountsFilters, AccountsInventoryExpenseRowDto, AccountsUtilityRowDto } from '../api/accounts/types'

/**
 * TanStack Query hooks for the Accounts dashboard. All queries are
 * read-only and admin-gated server-side. Cache keys include the full
 * filter object so any URL state change invalidates the cache.
 *
 * Stale time of 30 seconds matches the spec — long enough that
 * sub-second filter toggles don't refetch on every keystroke, short
 * enough that an admin who refreshes after a qty edit sees the new
 * adjustment immediately.
 */

const STALE_TIME = 30_000

export const accountsKeys = {
  summary:     (f: AccountsFilters) => ['accounts', 'summary',      f] as const,
  trend:       (f: AccountsFilters) => ['accounts', 'trend',        f] as const,
  byShop:      (f: AccountsFilters) => ['accounts', 'by-shop',      f] as const,
  byCategory:  (f: AccountsFilters) => ['accounts', 'by-category',  f] as const,
  topProducts: (f: AccountsFilters) => ['accounts', 'top-products', f] as const,
  adjustments: (f: AccountsFilters) => ['accounts', 'adjustments',  f] as const,
  inTransit:   (f: AccountsFilters) => ['accounts', 'in-transit',   f] as const,
  utilities:   (f: AccountsFilters) => ['accounts', 'utilities',    f] as const,
  godownExpenses: (f: AccountsFilters) => ['accounts', 'godown-expenses', f] as const,
  inventoryExpenses: (f: AccountsFilters) => ['accounts', 'inventory-expenses', f] as const,
}

export function useAccountsSummary(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.summary(filters),
    queryFn:  () => accountsApi.summary(filters),
    staleTime: STALE_TIME,
  })
}

export function useAccountsTrend(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.trend(filters),
    queryFn:  () => accountsApi.trend(filters),
    staleTime: STALE_TIME,
  })
}

export function useAccountsByShop(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.byShop(filters),
    queryFn:  () => accountsApi.byShop(filters),
    staleTime: STALE_TIME,
  })
}

export function useAccountsByCategory(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.byCategory(filters),
    queryFn:  () => accountsApi.byCategory(filters),
    staleTime: STALE_TIME,
  })
}

export function useAccountsTopProducts(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.topProducts(filters),
    queryFn:  () => accountsApi.topProducts(filters),
    staleTime: STALE_TIME,
  })
}

export function useAccountsAdjustments(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.adjustments(filters),
    queryFn:  () => accountsApi.adjustments(filters),
    staleTime: STALE_TIME,
  })
}

/** In-transit is anchored to "right now" (the SP ignores date range). The
 *  filter is still passed so shop / inventory filters are honoured. */
export function useAccountsInTransit(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.inTransit(filters),
    queryFn:  () => accountsApi.inTransit(filters),
    staleTime: STALE_TIME,
  })
}

/** Per-shop-per-category operating expenses (Rent / Electricity / Salary /
 *  …) — used to derive Net Profit (Gross Profit − Utilities) on the admin
 *  Dashboard + Accounts. 15-Jul-2026 client req. */
export function useAccountsUtilities(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.utilities(filters),
    queryFn:  () => accountsApi.utilities(filters),
    staleTime: STALE_TIME,
  })
}

/** Company-wide Inventory-role staff salary total (18-Jul-2026) — godowns
 *  aren't shop-scoped, so this is a single figure feeding Net Profit as its
 *  own line item, separate from the per-shop Utilities breakdown above. */
export function useAccountsGodownExpenses(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.godownExpenses(filters),
    queryFn:  () => accountsApi.godownExpenses(filters),
    staleTime: STALE_TIME,
  })
}

/** Per-inventory-per-category godown operational expenses (21-Jul-2026,
 *  client req) — mirror of useAccountsUtilities but for the godown side.
 *  Feeds a separate "Inventory Expenses" line on the admin Accounts screen.
 *  Distinct from useAccountsGodownExpenses above (which is staff salary). */
export function useAccountsInventoryExpenses(filters: AccountsFilters) {
  return useQuery({
    queryKey: accountsKeys.inventoryExpenses(filters),
    queryFn:  () => accountsApi.inventoryExpenses(filters),
    staleTime: STALE_TIME,
  })
}

// ══════════════════ Helper selectors ══════════════════
//
// Utility rows come in as one-per-(shop, category) — the callers usually
// want either the grand total (dashboard KPI) or a per-shop rollup (table
// column). Colocated with the hook so every consumer sums the same way.

/** Grand total across every (shop, category) row. Handles empty / undefined. */
export function totalUtilities(rows: AccountsUtilityRowDto[] | undefined): number {
  return (rows ?? []).reduce((sum, r) => sum + r.amount, 0)
}

/** Per-shop rollup: shopId → total utility amount for that shop. Absent
 *  shops implicitly map to 0 — callers should use `map.get(id) ?? 0`. */
export function utilitiesByShop(
  rows: AccountsUtilityRowDto[] | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows ?? []) {
    out.set(r.shopId, (out.get(r.shopId) ?? 0) + r.amount)
  }
  return out
}

/** Grand total across every (inventory, category) row — mirror of
 *  totalUtilities for the godown-side breakdown (21-Jul-2026). */
export function totalInventoryExpenses(rows: AccountsInventoryExpenseRowDto[] | undefined): number {
  return (rows ?? []).reduce((sum, r) => sum + r.amount, 0)
}

/** Per-inventory rollup: inventoryId → total expense amount for that
 *  godown. Absent inventories implicitly map to 0. */
export function inventoryExpensesByInventory(
  rows: AccountsInventoryExpenseRowDto[] | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows ?? []) {
    out.set(r.inventoryId, (out.get(r.inventoryId) ?? 0) + r.amount)
  }
  return out
}
