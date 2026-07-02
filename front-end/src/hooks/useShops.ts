import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { shopsApi } from '../api/shops/api'
import type { PagedResult } from '../api/types'
import type { CreateShopRequest, UpdateShopRequest, ShopDto } from '../api/shops/types'

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

/** Per-shop GST toggle (19-Jun-2026, client #15). Used by the
 *  AdminSettings GST section. Optimistic update on the cached shop lists so
 *  the switch feels instant; rollback on error. */
export function useToggleShopGst() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      shopsApi.setGstEnabled(id, enabled),

    onMutate: async (vars) => {
      // Optimistic: flip the cached lists immediately so the UI doesn't lag.
      await qc.cancelQueries({ queryKey: shopsKeys.all })
      const prevAll = qc.getQueryData<ShopDto[]>(shopsKeys.all)
      qc.setQueryData<ShopDto[]>(
        shopsKeys.all,
        (old) => old?.map(s => s.id === vars.id ? { ...s, gstEnabled: vars.enabled } : s) ?? old,
      )
      qc.setQueriesData<PagedResult<ShopDto>>(
        { queryKey: ['shops', 'paged'] },
        (old) => old ? { ...old, items: old.items.map(s => s.id === vars.id ? { ...s, gstEnabled: vars.enabled } : s) } : old,
      )
      return { prevAll }
    },

    onError: (_err, _vars, ctx) => {
      // Roll back optimistic write — the API call failed.
      if (ctx?.prevAll) qc.setQueryData(shopsKeys.all, ctx.prevAll)
      qc.invalidateQueries({ queryKey: shopsKeys.all })
      qc.invalidateQueries({ queryKey: ['shops', 'paged'] })
    },

    onSuccess: (updated, vars) => {
      // Sync the detail cache too, in case AdminSettings later opens an
      // edit dialog for the same shop.
      qc.setQueryData(shopsKeys.detail(vars.id), updated)
    },
  })
}
