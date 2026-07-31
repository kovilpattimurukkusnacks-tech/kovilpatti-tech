import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { keepPreviousData } from '@tanstack/react-query'
import { vendorPurchasesApi } from '../api/vendor-purchases/api'
import type {
  CreateVendorPurchaseRequest, UpdateVendorPurchaseRequest, VendorPurchaseListFilters,
} from '../api/vendor-purchases/types'

export const vendorPurchasesKeys = {
  all: ['vendor-purchases'] as const,
  list: (f?: VendorPurchaseListFilters) => ['vendor-purchases', 'list', f ?? {}] as const,
  detail: (id: string) => ['vendor-purchases', id] as const,
}

export function useVendorPurchases(filters?: VendorPurchaseListFilters) {
  return useQuery({
    queryKey: vendorPurchasesKeys.list(filters),
    queryFn: () => vendorPurchasesApi.list(filters),
    placeholderData: keepPreviousData,
  })
}

export function useVendorPurchase(id: string | undefined) {
  return useQuery({
    queryKey: id ? vendorPurchasesKeys.detail(id) : ['vendor-purchases', 'idle'],
    queryFn: () => vendorPurchasesApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateVendorPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateVendorPurchaseRequest) => vendorPurchasesApi.create(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorPurchasesKeys.all })
    },
  })
}

export function useUpdateVendorPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateVendorPurchaseRequest }) => vendorPurchasesApi.update(id, req),
    onSuccess: (updated, vars) => {
      qc.setQueryData(vendorPurchasesKeys.detail(vars.id), updated)
      qc.invalidateQueries({ queryKey: vendorPurchasesKeys.all })
    },
  })
}

export function useReceiveVendorPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => vendorPurchasesApi.receive(id),
    onSuccess: (updated) => {
      qc.setQueryData(vendorPurchasesKeys.detail(updated.id), updated)
      qc.invalidateQueries({ queryKey: vendorPurchasesKeys.all })
    },
  })
}

export function useCancelVendorPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => vendorPurchasesApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorPurchasesKeys.all })
    },
  })
}
