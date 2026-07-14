import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { billsApi } from '../api/bills/api'
import type { BillListFilters, CreateBillRequest } from '../api/bills/types'

export const billsKeys = {
  all: ['bills'] as const,
  products: (search?: string) => ['bills', 'products', search ?? ''] as const,
  list: (f?: BillListFilters) => ['bills', 'list', f ?? {}] as const,
  detail: (id: string) => ['bills', 'detail', id] as const,
}

/** Billing product grid — refetches on window focus so on-hand stays honest. */
export function useBillingProducts(search?: string) {
  return useQuery({
    queryKey: billsKeys.products(search),
    queryFn: () => billsApi.products(search),
    staleTime: 30_000,
  })
}

export function useBills(filters?: BillListFilters) {
  return useQuery({
    queryKey: billsKeys.list(filters),
    queryFn: () => billsApi.list(filters),
  })
}

export function useBill(id: string | undefined) {
  return useQuery({
    queryKey: billsKeys.detail(id ?? ''),
    queryFn: () => billsApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateBillRequest) => billsApi.create(req),
    onSuccess: () => {
      // Bill list + product on-hand both changed.
      qc.invalidateQueries({ queryKey: billsKeys.all })
    },
  })
}

export function useCancelBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => billsApi.cancel(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billsKeys.all })
    },
  })
}
