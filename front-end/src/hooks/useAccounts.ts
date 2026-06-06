import { useQuery } from '@tanstack/react-query'
import { accountsApi } from '../api/accounts/api'
import type { AccountsFilters } from '../api/accounts/types'

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
