import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shopUtilityExpensesApi } from '../api/shop-utility-expenses/api'
import type {
  ShopUtilityExpenseDto, CreateShopUtilityExpenseRequest, UpdateShopUtilityExpenseRequest,
} from '../api/shop-utility-expenses/types'

export const shopUtilityExpensesKeys = {
  all: ['shop-utility-expenses'] as const,
}

export function useShopUtilityExpenses() {
  return useQuery({
    queryKey: shopUtilityExpensesKeys.all,
    queryFn: () => shopUtilityExpensesApi.list(),
  })
}

export function useCreateShopUtilityExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateShopUtilityExpenseRequest) => shopUtilityExpensesApi.create(req),
    onSuccess: (created) => {
      qc.setQueryData<ShopUtilityExpenseDto[]>(shopUtilityExpensesKeys.all, (old) =>
        old ? [created, ...old] : [created])
    },
  })
}

export function useUpdateShopUtilityExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateShopUtilityExpenseRequest }) =>
      shopUtilityExpensesApi.update(id, req),
    onSuccess: (updated) => {
      qc.setQueryData<ShopUtilityExpenseDto[]>(shopUtilityExpensesKeys.all, (old) =>
        old ? old.map(e => e.id === updated.id ? updated : e) : old)
    },
  })
}

export function useDeleteShopUtilityExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => shopUtilityExpensesApi.remove(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<ShopUtilityExpenseDto[]>(shopUtilityExpensesKeys.all, (old) =>
        old ? old.filter(e => e.id !== id) : old)
    },
  })
}
