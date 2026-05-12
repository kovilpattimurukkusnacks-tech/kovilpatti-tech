/**
 * React Query hooks for the Inventories resource.
 *
 * Pattern (re-use for every resource):
 *   - One query-key constant per resource (`inventoriesKeys`).
 *   - Reads use `useQuery`. Writes use `useMutation` and invalidate the
 *     list query on success so the UI auto-refreshes.
 *   - No fetch / business logic here — that lives in `src/api/inventories/api.ts`.
 *   - Pages consume these hooks; they don't import the api layer directly.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { inventoriesApi } from '../api/inventories/api'
import type {
  CreateInventoryRequest, UpdateInventoryRequest, PagedResult, InventoryDto,
} from '../api/inventories/types'

export const inventoriesKeys = {
  all: ['inventories'] as const,
  paged: (page: number, pageSize: number) => ['inventories', 'paged', page, pageSize] as const,
  detail: (id: string) => ['inventories', id] as const,
}

export function useInventories() {
  return useQuery({
    queryKey: inventoriesKeys.all,
    queryFn: () => inventoriesApi.list(),
  })
}

export function useInventoriesPaged(page: number, pageSize: number) {
  return useQuery({
    queryKey: inventoriesKeys.paged(page, pageSize),
    queryFn: () => inventoriesApi.listPaged(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useInventory(id: string | undefined) {
  return useQuery({
    queryKey: id ? inventoriesKeys.detail(id) : ['inventories', 'idle'],
    queryFn: () => inventoriesApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateInventoryRequest) => inventoriesApi.create(req),
    onSuccess: (created) => {
      // Paged list (Inventories page)
      qc.setQueriesData<PagedResult<InventoryDto>>(
        { queryKey: ['inventories', 'paged'] },
        (old) => old ? {
          ...old,
          total: old.total + 1,
          items: old.items.length < old.pageSize ? [...old.items, created] : old.items,
        } : old,
      )
      // Unpaginated list (dropdowns in Shops + Staff forms)
      qc.setQueryData<InventoryDto[]>(
        inventoriesKeys.all,
        (old) => old ? [...old, created] : old,
      )
    },
  })
}

export function useUpdateInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateInventoryRequest }) =>
      inventoriesApi.update(id, req),
    onSuccess: (updated, vars) => {
      qc.setQueryData(inventoriesKeys.detail(vars.id), updated)
      qc.setQueriesData<PagedResult<InventoryDto>>(
        { queryKey: ['inventories', 'paged'] },
        (old) => old ? { ...old, items: old.items.map(i => i.id === vars.id ? updated : i) } : old,
      )
      // The non-paged list (used by dropdowns) is still invalidated — cheap and
      // ensures dropdowns reflect the new name immediately.
      qc.invalidateQueries({ queryKey: inventoriesKeys.all, exact: true })
    },
  })
}

export function useDeleteInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => inventoriesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoriesKeys.all })
    },
  })
}
