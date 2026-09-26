import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminPosApi } from '../api/admin-pos/api'
import type {
  AdminBillFilters, AdminCustomerFilters, AdminDateRange, AdminEodFilters, AdminReturnFilters,
} from '../api/admin-pos/types'
import type { CancelBillRequest, CreateBillReturnRequest } from '../api/bills/types'

// Phase 4d — admin POS views. The admin sees shop-side writes after the
// default 30 s staleTime (main.tsx) or on revisiting a tab. keepPreviousData
// stops the grids flashing empty while the next page / filter loads.
// 25-Sep-2026: the only writes are the overrides (cancel, late return,
// credit limit) — each invalidates every admin-pos query, since one change
// moves bills, returns, sales totals and credit balances together.

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

// ───────── Overrides (25-Sep-2026) ─────────

export function useAdminReturnableItems(billId: string | undefined) {
  return useQuery({
    queryKey: ['admin-pos', 'returnable', billId ?? ''],
    queryFn: () => adminPosApi.returnableItems(billId!),
    enabled: !!billId,
    staleTime: 0,
  })
}

export function useAdminRefundOptions(billId: string | undefined) {
  return useQuery({
    queryKey: ['admin-pos', 'refund-options', billId ?? ''],
    queryFn: () => adminPosApi.refundOptions(billId!),
    enabled: !!billId,
    staleTime: 0,
  })
}

export function useAdminCancelBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: CancelBillRequest }) => adminPosApi.cancelBill(id, req),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminPosKeys.all }),
  })
}

export function useAdminCreateReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateBillReturnRequest) => adminPosApi.createReturn(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminPosKeys.all }),
  })
}

export function useAdminSetCreditLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, creditLimit }: { customerId: string; creditLimit: number }) =>
      adminPosApi.setCreditLimit(customerId, creditLimit),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminPosKeys.all }),
  })
}
