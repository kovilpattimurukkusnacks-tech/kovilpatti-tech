import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { stockRequestsApi } from '../api/stock-requests/api'
import { NotFoundError } from '../api/errors'
import type {
  StockRequestListFilters, CreateStockRequestRequest, UpdateStockRequestRequest,
  RejectRequest, DispatchRequest, PagedResult, StockRequestDto, RequestStatus,
  RequestType, CreateReturnRequest, AcceptReturnRequest, EditDispatchedQtyRequest,
} from '../api/stock-requests/types'

export const stockRequestsKeys = {
  all: ['stock-requests'] as const,
  listMine:     (f?: StockRequestListFilters) => ['stock-requests', 'mine',     f ?? {}] as const,
  listIncoming: (f?: StockRequestListFilters) => ['stock-requests', 'incoming', f ?? {}] as const,
  listAll:      (f?: StockRequestListFilters) => ['stock-requests', 'all',      f ?? {}] as const,
  detail:       (id: string)                  => ['stock-requests', id] as const,
  shopDraft:    ()                            => ['stock-requests', 'shop-draft'] as const,
}

// ─── Queries ─────────────────────────────────────────────

export function useMyStockRequests(filters?: StockRequestListFilters, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: stockRequestsKeys.listMine(filters),
    queryFn: () => stockRequestsApi.listMine(filters),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
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

/** Per-shop request counts for the active status filter — drives the shop
 *  quick-filter chips on the admin/inventory list pages. Refetches when the
 *  status changes; keeps the prior result visible during the refetch so the
 *  chip row doesn't blink to empty. */
export function useRequestCountByShop(args?: { status?: RequestStatus; inventoryId?: string; fromDate?: string; toDate?: string; requestType?: RequestType }) {
  return useQuery({
    queryKey: ['stock-requests', 'count-by-shop',
      args?.status ?? 'all', args?.inventoryId ?? 'all',
      args?.fromDate ?? '', args?.toDate ?? '',
      args?.requestType ?? 'all'] as const,
    queryFn: () => stockRequestsApi.countByShop(args),
    placeholderData: keepPreviousData,
  })
}

/**
 * The shop user's single live draft (or `null` when none exists). 404 from
 * the BE is mapped to `null` so the UI doesn't need to special-case the
 * "you don't have a draft yet" path as an error.
 *
 * Pass `enabled: false` when the caller isn't a ShopUser — the BE rejects
 * the call with 403 otherwise.
 */
export function useShopDraft(options?: { enabled?: boolean }) {
  return useQuery<StockRequestDto | null>({
    queryKey: stockRequestsKeys.shopDraft(),
    queryFn: async () => {
      try {
        return await stockRequestsApi.getDraft()
      } catch (e) {
        if (e instanceof NotFoundError) return null
        throw e
      }
    },
    enabled: options?.enabled ?? true,
    // Drafts mutate from the same browser tab (Save/Submit/Delete buttons),
    // so React Query's automatic refetch on focus is overkill — leave it on
    // and rely on explicit invalidation from the mutation onSuccess handlers.
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
  // Status changes (approve/reject/dispatch/etc.) shift the request across
  // the shop-filter chips' badge counts — refetch them too.
  qc.invalidateQueries({ queryKey: ['stock-requests', 'count-by-shop'] })
  qc.invalidateQueries({ queryKey: ['stock-requests', 'cumulative']    })
  // Dispatching clears draft_dispatched_qty; approving/rejecting/revoking
  // change the status. All can shift rows in/out of the inventory drafts
  // list, so invalidate it on any of these mutations.
  qc.invalidateQueries({ queryKey: ['stock-requests', 'dispatch-drafts'] })
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
      // Submit consumes the draft (BE-side, in fn_request_create). Clear the
      // cached draft so the Resume Draft strip disappears immediately.
      qc.setQueryData<StockRequestDto | null>(stockRequestsKeys.shopDraft(), null)
    },
  })
}

/** Save (or replace) the shop user's single live draft. */
export function useSaveShopDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateStockRequestRequest) => stockRequestsApi.saveDraft(req),
    onSuccess: (draft) => {
      // Seed the cache with the fresh draft so subsequent reads (e.g. another
      // tab) get the latest items without a refetch round-trip.
      qc.setQueryData<StockRequestDto | null>(stockRequestsKeys.shopDraft(), draft)
    },
  })
}

/** Discard the shop user's draft. */
export function useDeleteShopDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => stockRequestsApi.deleteDraft(),
    onSuccess: () => {
      qc.setQueryData<StockRequestDto | null>(stockRequestsKeys.shopDraft(), null)
    },
  })
}

/** Save WIP dispatch quantities without finalising (Inventory/Admin). */
export function useSaveDispatchDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: DispatchRequest }) =>
      stockRequestsApi.saveDispatchDraft(id, req),
    onSuccess: (updated) => {
      // Status didn't change but the items DTO now carries the new
      // draft_dispatched_qty values — refresh the detail cache so the
      // dispatch screen can re-seed its qty inputs if it's remounted.
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      // The inventory list page shows a "Resume dispatch draft" strip
      // sourced from this cache — refetch so a freshly saved draft
      // appears (or stops appearing, if it was just cleared).
      qc.invalidateQueries({ queryKey: ['stock-requests', 'dispatch-drafts'] })
    },
  })
}

/** Discard the saved dispatch draft on a request (Inventory/Admin). */
export function useClearDispatchDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stockRequestsApi.clearDispatchDraft(id),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      qc.invalidateQueries({ queryKey: ['stock-requests', 'dispatch-drafts'] })
    },
  })
}

/** Pending/Approved requests that have a saved dispatch draft on at least
 *  one item. Drives the inventory list page's "Resume dispatch draft" strip.
 *  Inventory user's scope is forced server-side, so no inventoryId arg. */
export function useInventoryDispatchDrafts() {
  return useQuery({
    queryKey: ['stock-requests', 'dispatch-drafts'] as const,
    queryFn: () => stockRequestsApi.dispatchDrafts(),
    placeholderData: keepPreviousData,
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

/** Shop user creates a Return — items go back to the godown. Same cache
 *  invalidation as useCreateStockRequest: only the shop's "mine" list needs
 *  the new row visible immediately; other lists refetch when the inventory
 *  user navigates to /incoming. */
export function useCreateReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateReturnRequest) => stockRequestsApi.createReturn(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-requests', 'mine'] })
    },
  })
}

/** Inventory/Admin accepts a Pending Return (terminal Accepted). Same
 *  invalidation strategy as the other lifecycle mutations — patch the row in
 *  every cached paged list AND refetch (so status filters drop it from
 *  Needs-Action and pick it up on the All chip). */
export function useAcceptReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: AcceptReturnRequest }) =>
      stockRequestsApi.acceptReturn(id, req),
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

/** Admin's post-completion dispatched_qty edit. Same patch-on-success
 *  strategy as the lifecycle mutations — qty totals on the parent change,
 *  so list caches need to reflect that too (delivered amount column). */
export function useEditDispatchedQty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, itemId, req }: {
      requestId: string
      itemId:    string
      req:       EditDispatchedQtyRequest
    }) => stockRequestsApi.editDispatchedQty(requestId, itemId, req),
    onSuccess: (updated) => {
      qc.setQueryData(stockRequestsKeys.detail(updated.id), updated)
      patchAllListCaches(qc, updated)
    },
  })
}
