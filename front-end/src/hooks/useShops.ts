import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { shopsApi } from '../api/shops/api'
import type { CreateShopRequest, UpdateShopRequest, PagedResult, ShopDto } from '../api/shops/types'

export const shopsKeys = {
  all: ['shops'] as const,
  paged: (page: number, pageSize: number) => ['shops', 'paged', page, pageSize] as const,
  detail: (id: string) => ['shops', id] as const,
}

export function useShops() {
  return useQuery({
    queryKey: shopsKeys.all,
    queryFn: () => shopsApi.list(),
  })
}

export function useShopsPaged(page: number, pageSize: number) {
  return useQuery({
    queryKey: shopsKeys.paged(page, pageSize),
    queryFn: () => shopsApi.listPaged(page, pageSize),
    placeholderData: keepPreviousData,
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
    onSuccess: (created) => {
      // Paged list (Shops page)
      qc.setQueriesData<PagedResult<ShopDto>>(
        { queryKey: ['shops', 'paged'] },
        (old) => old ? {
          ...old,
          total: old.total + 1,
          items: old.items.length < old.pageSize ? [...old.items, created] : old.items,
        } : old,
      )
      // Unpaginated list (dropdowns in Staff form)
      qc.setQueryData<ShopDto[]>(
        shopsKeys.all,
        (old) => old ? [...old, created] : old,
      )
    },
  })
}

export function useUpdateShop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateShopRequest }) => shopsApi.update(id, req),
    onSuccess: (updated, vars) => {
      qc.setQueryData(shopsKeys.detail(vars.id), updated)
      qc.setQueriesData<PagedResult<ShopDto>>(
        { queryKey: ['shops', 'paged'] },
        (old) => old ? { ...old, items: old.items.map(s => s.id === vars.id ? updated : s) } : old,
      )
      qc.invalidateQueries({ queryKey: shopsKeys.all, exact: true })
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
