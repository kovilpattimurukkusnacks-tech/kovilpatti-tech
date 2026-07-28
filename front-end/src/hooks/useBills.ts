import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { billsApi } from '../api/bills/api'
import type {
  BillListFilters, CreateBillRequest, CancelBillRequest,
  BillReturnListFilters, CreateBillReturnRequest, CreateHoldRequest,
} from '../api/bills/types'

export const billsKeys = {
  all: ['bills'] as const,
  products: (search?: string) => ['bills', 'products', search ?? ''] as const,
  list: (f?: BillListFilters) => ['bills', 'list', f ?? {}] as const,
  detail: (id: string) => ['bills', 'detail', id] as const,
  returnable: (billId: string) => ['bills', 'returnable', billId] as const,
  returns: (f?: BillReturnListFilters) => ['bills', 'returns', f ?? {}] as const,
  returnDetail: (id: string) => ['bills', 'returns', 'detail', id] as const,
  holds: ['bills', 'holds'] as const,
}

/** Billing product grid — refetches on window focus so on-hand stays honest. */
export function useBillingProducts(search?: string) {
  return useQuery({
    queryKey: billsKeys.products(search),
    queryFn: () => billsApi.products(search),
    staleTime: 30_000,
  })
}

export function useBills(filters?: BillListFilters) {
  return useQuery({
    queryKey: billsKeys.list(filters),
    queryFn: () => billsApi.list(filters),
  })
}

export function useBill(id: string | undefined) {
  return useQuery({
    queryKey: billsKeys.detail(id ?? ''),
    queryFn: () => billsApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateBillRequest) => billsApi.create(req),
    onSuccess: () => {
      // Bill list + product on-hand both changed.
      qc.invalidateQueries({ queryKey: billsKeys.all })
    },
  })
}

export function useCancelBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: CancelBillRequest }) => billsApi.cancel(id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billsKeys.all })
    },
  })
}

// ───────── Bill returns (feature #1) ─────────

/** Returnable lines for a bill — drives the return dialog; fresh each open. */
export function useReturnableItems(billId: string | undefined) {
  return useQuery({
    queryKey: billsKeys.returnable(billId ?? ''),
    queryFn: () => billsApi.returnableItems(billId!),
    enabled: !!billId,
    staleTime: 0,
  })
}

export function useBillReturns(filters?: BillReturnListFilters) {
  return useQuery({
    queryKey: billsKeys.returns(filters),
    queryFn: () => billsApi.listReturns(filters),
  })
}

export function useBillReturn(id: string | undefined) {
  return useQuery({
    queryKey: billsKeys.returnDetail(id ?? ''),
    queryFn: () => billsApi.getReturn(id!),
    enabled: !!id,
  })
}

export function useCreateBillReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateBillReturnRequest) => billsApi.createReturn(req),
    onSuccess: () => {
      // Return puts stock back and creates a return record — bills, returns,
      // and product on-hand all changed.
      qc.invalidateQueries({ queryKey: billsKeys.all })
    },
  })
}

// ───────── Held (draft) bills (feature #3) ─────────

export function useHolds() {
  return useQuery({
    queryKey: billsKeys.holds,
    queryFn: () => billsApi.holdList(),
  })
}

export function useCreateHold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateHoldRequest) => billsApi.holdCreate(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: billsKeys.holds }),
  })
}

export function useDeleteHold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => billsApi.holdDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: billsKeys.holds }),
  })
}
