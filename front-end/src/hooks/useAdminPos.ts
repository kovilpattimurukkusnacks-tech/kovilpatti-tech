import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminPosApi } from '../api/admin-pos/api'
import type {
  AdminBillFilters, AdminCustomerFilters, AdminDateRange, AdminEodFilters, AdminReturnFilters,
} from '../api/admin-pos/types'

// Phase 4d — admin POS views. All read-only, so no mutations here; the
// admin sees shop-side writes after the default 30 s staleTime (main.tsx)
// or on revisiting a tab. keepPreviousData stops the grids flashing empty
// while the next page / filter loads.

export const adminPosKeys = {
  all:          ['admin-pos'] as const,
  bills:        (f: AdminBillFilters)     => ['admin-pos', 'bills', f] as const,
  bill:         (id: string)              => ['admin-pos', 'bill', id] as const,
  returns:      (f: AdminReturnFilters)   => ['admin-pos', 'returns', f] as const,
  returnDetail: (id: string)              => ['admin-pos', 'return', id] as const,
  eod:          (f: AdminEodFilters)      => ['admin-pos', 'eod', f] as const,
  eodDenoms:    (id: string)              => ['admin-pos', 'eod-denoms', id] as const,
  customers:    (f: AdminCustomerFilters) => ['admin-pos', 'customers', f] as const,
  ledger:       (id: string, page: number) => ['admin-pos', 'ledger', id, page] as const,
  summary:      (r: AdminDateRange)       => ['admin-pos', 'sales', 'summary', r] as const,
  byShop:       (r: AdminDateRange)       => ['admin-pos', 'sales', 'by-shop', r.from, r.to] as const,
  daily:        (r: AdminDateRange)       => ['admin-pos', 'sales', 'daily', r] as const,
  topProducts:  (r: AdminDateRange)       => ['admin-pos', 'sales', 'top', r] as const,
}

export function useAdminBills(f: AdminBillFilters) {
  return useQuery({ queryKey: adminPosKeys.bills(f), queryFn: () => adminPosApi.bills(f), placeholderData: keepPreviousData })
}

export function useAdminBill(id: string | null) {
  return useQuery({
    queryKey: adminPosKeys.bill(id ?? ''),
    queryFn: () => adminPosApi.bill(id!),
    enabled: !!id,
  })
}

export function useAdminReturns(f: AdminReturnFilters) {
  return useQuery({ queryKey: adminPosKeys.returns(f), queryFn: () => adminPosApi.returns(f), placeholderData: keepPreviousData })
}

export function useAdminReturn(id: string | null) {
  return useQuery({
    queryKey: adminPosKeys.returnDetail(id ?? ''),
    queryFn: () => adminPosApi.returnDetail(id!),
    enabled: !!id,
  })
}

export function useAdminEod(f: AdminEodFilters) {
  return useQuery({ queryKey: adminPosKeys.eod(f), queryFn: () => adminPosApi.eod(f), placeholderData: keepPreviousData })
}

export function useAdminEodDenominations(id: string | null) {
  return useQuery({
    queryKey: adminPosKeys.eodDenoms(id ?? ''),
    queryFn: () => adminPosApi.eodDenominations(id!),
    enabled: !!id,
  })
}

export function useAdminCustomers(f: AdminCustomerFilters) {
  return useQuery({ queryKey: adminPosKeys.customers(f), queryFn: () => adminPosApi.customers(f), placeholderData: keepPreviousData })
}

export function useAdminCustomerLedger(id: string | null, page: number) {
  return useQuery({
    queryKey: adminPosKeys.ledger(id ?? '', page),
    queryFn: () => adminPosApi.customerLedger(id!, page),
    enabled: !!id,
    placeholderData: keepPreviousData,
  })
}

export function useAdminSalesSummary(r: AdminDateRange) {
  return useQuery({ queryKey: adminPosKeys.summary(r), queryFn: () => adminPosApi.salesSummary(r) })
}

export function useAdminSalesByShop(r: AdminDateRange, enabled = true) {
  return useQuery({
    queryKey: adminPosKeys.byShop(r),
    queryFn: () => adminPosApi.salesByShop({ from: r.from, to: r.to }),
    enabled,
  })
}

export function useAdminSalesDaily(r: AdminDateRange) {
  return useQuery({ queryKey: adminPosKeys.daily(r), queryFn: () => adminPosApi.salesDaily(r) })
}

export function useAdminSalesTopProducts(r: AdminDateRange) {
  return useQuery({ queryKey: adminPosKeys.topProducts(r), queryFn: () => adminPosApi.salesTopProducts(r, 20) })
}
