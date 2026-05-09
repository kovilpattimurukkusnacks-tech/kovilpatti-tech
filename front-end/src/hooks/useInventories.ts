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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoriesApi } from '../api/inventories/api'
import type {
  CreateInventoryRequest, UpdateInventoryRequest,
} from '../api/inventories/types'

export const inventoriesKeys = {
  all: ['inventories'] as const,
  detail: (id: string) => ['inventories', id] as const,
}

export function useInventories() {
  return useQuery({
    queryKey: inventoriesKeys.all,
    queryFn: () => inventoriesApi.list(),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoriesKeys.all })
    },
  })
}

export function useUpdateInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateInventoryRequest }) =>
      inventoriesApi.update(id, req),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: inventoriesKeys.all })
      qc.invalidateQueries({ queryKey: inventoriesKeys.detail(vars.id) })
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
