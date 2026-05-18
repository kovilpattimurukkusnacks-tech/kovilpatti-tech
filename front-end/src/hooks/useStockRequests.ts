import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { stockRequestsApi } from '../api/stock-requests/api'
import type {
  StockRequestListFilters, CreateStockRequestRequest, UpdateStockRequestRequest,
  RejectRequest, DispatchRequest, PagedResult, StockRequestDto,
} from '../api/stock-requests/types'

export const stockRequestsKeys = {
  all: ['stock-requests'] as const,
  listMine:     (f?: StockRequestListFilters) => ['stock-requests', 'mine',     f ?? {}] as const,
  listIncoming: (f?: StockRequestListFilters) => ['stock-requests', 'incoming', f ?? {}] as const,
  listAll:      (f?: StockRequestListFilters) => ['stock-requests', 'all',      f ?? {}] as const,
  detail:       (id: string)                  => ['stock-requests', id] as const,
}

// ─── Queries ─────────────────────────────────────────────

export function useMyStockRequests(filters?: StockRequestListFilters) {
  return useQuery({
    queryKey: stockRequestsKeys.listMine(filters),
    queryFn: () => stockRequestsApi.listMine(filters),
    placeholderData: keepPreviousData,
  })
}

export function useIncomingStockRequests(filters?: StockRequestListFilters) {
  return useQuery({
    queryKey: stockRequestsKeys.listIncoming(filters),
    queryFn: () => stockRequestsApi.listIncoming(filters),
    placeholderData: keepPreviousData,
  })
}

export function useAllStockRequests(filters?: StockRequestListFilters) {
  return useQuery({
    queryKey: stockRequestsKeys.listAll(filters),
    queryFn: () => stockRequestsApi.listAll(filters),
    placeholderData: keepPreviousData,
  })
}

export function useStockRequest(id: string | undefined) {
  return useQuery({
    queryKey: id ? stockRequestsKeys.detail(id) : ['stock-requests', 'idle'],
    queryFn: () => stockRequestsApi.get(id!),
    enabled: !!id,
  })
}

/** Cumulative pending workload — used by the kitchen batch report. */
export function useCumulativePending(inventoryId?: string) {
  return useQuery({
    queryKey: ['stock-requests', 'cumulative', inventoryId ?? 'all'] as const,
    queryFn: () => stockRequestsApi.cumulative(inventoryId),
    // Print page mounts, fetches, prints. No need to cache long.
    staleTime: 0,
  })
}

// ─── Mutations ───────────────────────────────────────────

/**
 * Common cache strategy for mutations on a single request:
 *   - patch the row inside every cached paged list   → row updates instantly
 *     so the user sees the new status reflected even if they navigate back
 *     to the list before the refetch finishes.
 *   - invalidate the same lists                       → forces a refetch so
 *     status-filtered views (e.g. "Needs Action" = Approved) drop rows whose
 *     new status no longer matches the filter. Patching alone keeps the row
 *     in place because filters are only re-evaluated on a network refetch.
 *
 * The detail cache is updated separately by the caller via setQueryData.
 */
function patchAllListCaches(qc: ReturnType<typeof useQueryClient>, updated: StockRequestDto) {
  const patcher = (old: PagedResult<StockRequestDto> | undefined) =>
    old ? { ...old, items: old.items.map(r => r.id === updated.id ? { ...r, ...updated, items: r.items } : r) } : old

  qc.setQueriesData<PagedResult<StockRequestDto>>({ queryKey: ['stock-requests', 'mine'] },     patcher)
  qc.setQueriesData<PagedResult<StockRequestDto>>({ queryKey: ['stock-requests', 'incoming'] }, patcher)
  qc.setQueriesData<PagedResult<StockRequestDto>>({ queryKey: ['stock-requests', 'all'] },      patcher)

  qc.invalidateQueries({ queryKey: ['stock-requests', 'mine']     })
  qc.invalidateQueries({ queryKey: ['stock-requests', 'incoming'] })
  qc.invalidateQueries({ queryKey: ['stock-requests', 'all']      })
}

export function useCreateStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateStockRequestRequest) => stockRequestsApi.create(req),
    // For create, we don't try to insert into the paged list (sort order is by
    // submitted_at DESC — new row would appear at the top of page 1). Simpler
    // to invalidate just the "mine" list since shop user lands back on it.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-requests', 'mine'] })
    },
  })
}

export function useUpdateStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateStockRequestRequest }) =>
      stockRequestsApi.update(id, req),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}

export function useApproveStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stockRequestsApi.approve(id),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}

export function useRejectStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: RejectRequest }) =>
      stockRequestsApi.reject(id, req),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}

/** Reverse an Approve/Reject decision — status flips back to Pending. */
export function useRevokeStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stockRequestsApi.revoke(id),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}

export function useDispatchStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: DispatchRequest }) =>
      stockRequestsApi.dispatch(id, req),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}

export function useReceiveStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stockRequestsApi.receive(id),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}

export function useCancelStockRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stockRequestsApi.cancel(id),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}
