import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { vendorsApi, type VendorListFilters } from '../api/vendors/api'
import type { CreateVendorRequest, UpdateVendorRequest } from '../api/vendors/types'

export const vendorsKeys = {
  all: ['vendors'] as const,
  paged: (f?: VendorListFilters) => ['vendors', 'paged', f ?? {}] as const,
  detail: (id: string) => ['vendors', id] as const,
}

export function useVendors() {
  return useQuery({
    queryKey: vendorsKeys.all,
    queryFn: () => vendorsApi.list(),
  })
}

export function useVendorsPaged(filters?: VendorListFilters) {
  return useQuery({
    queryKey: vendorsKeys.paged(filters),
    queryFn: () => vendorsApi.listPaged(filters),
    placeholderData: keepPreviousData,
  })
}

export function useVendor(id: string | undefined) {
  return useQuery({
    queryKey: id ? vendorsKeys.detail(id) : ['vendors', 'idle'],
    queryFn: () => vendorsApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateVendorRequest) => vendorsApi.create(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorsKeys.all })
    },
  })
}

export function useUpdateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateVendorRequest }) => vendorsApi.update(id, req),
    onSuccess: (updated, vars) => {
      qc.setQueryData(vendorsKeys.detail(vars.id), updated)
      qc.invalidateQueries({ queryKey: vendorsKeys.all })
    },
  })
}

export function useDeleteVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => vendorsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorsKeys.all })
    },
  })
}
