import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ewayBillsApi } from '../api/eway-bills/api'
import type { RecordEwayBillRequest } from '../api/eway-bills/types'
import { vendorPurchasesKeys } from './useVendorPurchases'

export const ewayBillsKeys = {
  all: ['eway-bills'] as const,
  forPurchase: (purchaseId: string) => ['eway-bills', 'for-purchase', purchaseId] as const,
  inboundThreshold: () => ['eway-bills', 'threshold', 'inbound'] as const,
}

export function useEwayBillsForPurchase(purchaseId: string | undefined) {
  return useQuery({
    queryKey: purchaseId ? ewayBillsKeys.forPurchase(purchaseId) : ['eway-bills', 'idle'],
    queryFn: () => ewayBillsApi.listForPurchase(purchaseId!),
    enabled: !!purchaseId,
  })
}

// Threshold is app-wide config — cache it for the session. Doesn't change
// unless the client edits it via Settings, which is an admin-only action.
export function useEwayInboundThreshold() {
  return useQuery({
    queryKey: ewayBillsKeys.inboundThreshold(),
    queryFn: () => ewayBillsApi.inboundThreshold(),
    staleTime: 5 * 60 * 1000, // 5 min — cheap read but doesn't need to be fresh
  })
}

export function useRecordEwayBill(purchaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: RecordEwayBillRequest) => ewayBillsApi.record(purchaseId, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ewayBillsKeys.forPurchase(purchaseId) })
      // Purchase detail carries the "has e-way?" derived state — refresh it too.
      qc.invalidateQueries({ queryKey: vendorPurchasesKeys.detail(purchaseId) })
    },
  })
}

export function useCancelEwayBill(purchaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      ewayBillsApi.cancel(purchaseId, id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ewayBillsKeys.forPurchase(purchaseId) })
      qc.invalidateQueries({ queryKey: vendorPurchasesKeys.detail(purchaseId) })
    },
  })
}
