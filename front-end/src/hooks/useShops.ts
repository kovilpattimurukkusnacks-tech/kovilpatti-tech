import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shopsApi } from '../api/shops/api'
import type { CreateShopRequest, UpdateShopRequest } from '../api/shops/types'

export const shopsKeys = {
  all: ['shops'] as const,
  detail: (id: string) => ['shops', id] as const,
}

export function useShops() {
  return useQuery({
    queryKey: shopsKeys.all,
    queryFn: () => shopsApi.list(),
  })
}

export function useShop(id: string | undefined) {
  return useQuery({
    queryKey: id ? shopsKeys.detail(id) : ['shops', 'idle'],
    queryFn: () => shopsApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateShop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateShopRequest) => shopsApi.create(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shopsKeys.all })
    },
  })
}

export function useUpdateShop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateShopRequest }) => shopsApi.update(id, req),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: shopsKeys.all })
      qc.invalidateQueries({ queryKey: shopsKeys.detail(vars.id) })
    },
  })
}

export function useDeleteShop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => shopsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shopsKeys.all })
    },
  })
}
