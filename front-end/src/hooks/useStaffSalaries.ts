import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { staffSalariesApi } from '../api/staff-salaries/api'
import type {
  SetStaffSalaryRequest, PaySalaryRequest, DeductSalaryRequest,
} from '../api/staff-salaries/types'

export const staffSalariesKeys = {
  all: ['staff-salaries'] as const,
  // Scoped per (from, to) so switching the month filter caches independently.
  list: (from: string, to: string) =>
    [...staffSalariesKeys.all, 'list', from, to] as const,
  transactions: (staffId: string, from: string, to: string) =>
    [...staffSalariesKeys.all, 'transactions', staffId, from, to] as const,
}

export function useStaffSalaries(from: string, to: string) {
  return useQuery({
    queryKey: staffSalariesKeys.list(from, to),
    queryFn: () => staffSalariesApi.list(from, to),
  })
}

/** Lazy — only fetches once `enabled` (the hover/open trigger). Small,
 *  per-staff history list for the "hover the Net figure" breakdown. */
export function useStaffSalaryTransactions(staffId: string, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: staffSalariesKeys.transactions(staffId, from, to),
    queryFn: () => staffSalariesApi.transactions(staffId, from, to),
    enabled,
  })
}

// Mutations invalidate the whole `all` prefix (matches every cached month)
// rather than hand-patching the cache — same pattern as useShopUtilityExpenses.
export function useSetStaffSalary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: SetStaffSalaryRequest) => staffSalariesApi.set(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffSalariesKeys.all })
    },
  })
}

export function usePaySalary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: PaySalaryRequest) => staffSalariesApi.pay(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffSalariesKeys.all })
    },
  })
}

export function useDeductSalary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: DeductSalaryRequest) => staffSalariesApi.deduct(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffSalariesKeys.all })
    },
  })
}
