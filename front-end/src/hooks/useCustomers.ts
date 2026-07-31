import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customersApi } from '../api/customers/api'
import type {
  CreateCustomerRequest, SettleCreditRequest, CustomerListFilters,
} from '../api/customers/types'

export const customersKeys = {
  all: ['customers'] as const,
  list: (f?: CustomerListFilters) => ['customers', 'list', f ?? {}] as const,
  ledger: (id: string, page: number) => ['customers', 'ledger', id, page] as const,
}

export function useCustomerList(filters?: CustomerListFilters) {
  return useQuery({
    queryKey: customersKeys.list(filters),
    queryFn: () => customersApi.list(filters),
  })
}

export function useCustomerLedger(id: string | undefined, page = 1) {
  return useQuery({
    queryKey: customersKeys.ledger(id ?? '', page),
    queryFn: () => customersApi.ledger(id!, page),
    enabled: !!id,
  })
}

/** Imperative phone lookup — used from the POS header on demand. */
export function useLookupCustomer() {
  return useMutation({
    mutationFn: (phone: string) => customersApi.lookup(phone),
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateCustomerRequest) => customersApi.create(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: customersKeys.all }),
  })
}

export function useSettleCredit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: SettleCreditRequest }) =>
      customersApi.settle(id, req),
    onSuccess: () => qc.invalidateQueries({ queryKey: customersKeys.all }),
  })
}
