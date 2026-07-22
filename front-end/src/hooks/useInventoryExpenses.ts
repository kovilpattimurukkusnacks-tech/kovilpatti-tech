import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryExpensesApi } from '../api/inventory-expenses/api'
import type {
  CreateInventoryExpenseRequest, UpdateInventoryExpenseRequest,
} from '../api/inventory-expenses/types'

export const inventoryExpensesKeys = {
  all: ['inventory-expenses'] as const,
  // Scoped per (from, to) so switching the month filter caches independently
  // instead of colliding on one shared list key.
  list: (from?: string, to?: string) =>
    [...inventoryExpensesKeys.all, 'list', from ?? null, to ?? null] as const,
}

export function useInventoryExpenses(from?: string, to?: string) {
  return useQuery({
    queryKey: inventoryExpensesKeys.list(from, to),
    queryFn: () => inventoryExpensesApi.list(from, to),
  })
}

// Mutations invalidate the whole `all` prefix (matches every cached month,
// not just the one currently viewed) rather than hand-editing one month's
// cached array — simpler and correct regardless of which month is open.
export function useCreateInventoryExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateInventoryExpenseRequest) => inventoryExpensesApi.create(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryExpensesKeys.all })
    },
  })
}

export function useUpdateInventoryExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateInventoryExpenseRequest }) =>
      inventoryExpensesApi.update(id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryExpensesKeys.all })
    },
  })
}

export function useDeleteInventoryExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => inventoryExpensesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryExpensesKeys.all })
    },
  })
}
