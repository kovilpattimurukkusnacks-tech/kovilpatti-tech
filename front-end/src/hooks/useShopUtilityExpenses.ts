import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shopUtilityExpensesApi } from '../api/shop-utility-expenses/api'
import type {
  CreateShopUtilityExpenseRequest, UpdateShopUtilityExpenseRequest,
} from '../api/shop-utility-expenses/types'

export const shopUtilityExpensesKeys = {
  all: ['shop-utility-expenses'] as const,
  // Scoped per (from, to) so switching the month filter caches independently
  // instead of colliding on one shared list key.
  list: (from?: string, to?: string) =>
    [...shopUtilityExpensesKeys.all, 'list', from ?? null, to ?? null] as const,
}

export function useShopUtilityExpenses(from?: string, to?: string) {
  return useQuery({
    queryKey: shopUtilityExpensesKeys.list(from, to),
    queryFn: () => shopUtilityExpensesApi.list(from, to),
  })
}

// Mutations invalidate the whole `all` prefix (matches every cached month,
// not just the one currently viewed) rather than hand-editing one month's
// cached array — simpler and correct regardless of which month is open.
export function useCreateShopUtilityExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateShopUtilityExpenseRequest) => shopUtilityExpensesApi.create(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shopUtilityExpensesKeys.all })
    },
  })
}

export function useUpdateShopUtilityExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateShopUtilityExpenseRequest }) =>
      shopUtilityExpensesApi.update(id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shopUtilityExpensesKeys.all })
    },
  })
}

export function useDeleteShopUtilityExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => shopUtilityExpensesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shopUtilityExpensesKeys.all })
    },
  })
}
