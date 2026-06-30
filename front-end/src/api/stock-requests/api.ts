import { apiClient } from '../client'
import type {
  StockRequestDto, CreateStockRequestRequest, UpdateStockRequestRequest,
  RejectRequest, DispatchRequest, StockRequestListFilters, PagedResult,
  CumulativePendingLine, ShopRequestCount, RequestStatus, RequestType,
  CreateReturnRequest, AcceptReturnRequest, EditDispatchedQtyRequest,
  RenameDispatchDraftRequest, PinDispatchDraftRequest,
} from './types'

function toQuery(filters?: StockRequestListFilters): string {
  if (!filters) return ''
  const p = new URLSearchParams()
  if (filters.shopId)        p.set('shopId', filters.shopId)
  if (filters.inventoryId)   p.set('inventoryId', filters.inventoryId)
  if (filters.status)        p.set('status', filters.status)
  if (filters.search)        p.set('search', filters.search)
  if (filters.page != null)     p.set('page', String(filters.page))
  if (filters.pageSize != null) p.set('pageSize', String(filters.pageSize))
  if (filters.fromDate)         p.set('fromDate', filters.fromDate)
  if (filters.toDate)           p.set('toDate', filters.toDate)
  if (filters.requestType)      p.set('requestType', filters.requestType)
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const stockRequestsApi = {
  // Admin — all requests
  listAll:      (f?: StockRequestListFilters)      => apiClient.get<PagedResult<StockRequestDto>>(`/api/stock-requests${toQuery(f)}`),

  // Shop user — own shop's requests
  listMine:     (f?: StockRequestListFilters)      => apiClient.get<PagedResult<StockRequestDto>>(`/api/stock-requests/mine${toQuery(f)}`),

  // Inventory user — incoming for own godown
  listIncoming: (f?: StockRequestListFilters)      => apiClient.get<PagedResult<StockRequestDto>>(`/api/stock-requests/incoming${toQuery(f)}`),

  // Cumulative-pending workload report (Inventory + Admin)
  cumulative:   (inventoryId?: string)             =>
    apiClient.get<CumulativePendingLine[]>(
      `/api/stock-requests/print/cumulative${inventoryId ? `?inventoryId=${inventoryId}` : ''}`,
    ),

  // Per-shop request count for the active status filter (Inventory + Admin).
  // Drives the shop quick-filter chips below the status presets.
  countByShop: (args?: { status?: RequestStatus; inventoryId?: string; fromDate?: string; toDate?: string; requestType?: RequestType }) => {
    const p = new URLSearchParams()
    if (args?.status)      p.set('status', args.status)
    if (args?.inventoryId) p.set('inventoryId', args.inventoryId)
    if (args?.fromDate)    p.set('fromDate', args.fromDate)
    if (args?.toDate)      p.set('toDate', args.toDate)
    if (args?.requestType) p.set('requestType', args.requestType)
    const qs = p.toString()
    return apiClient.get<ShopRequestCount[]>(`/api/stock-requests/count-by-shop${qs ? `?${qs}` : ''}`)
  },

  // Detail (any role; BE enforces ownership)
  get:          (id: string)                       => apiClient.get<StockRequestDto>(`/api/stock-requests/${id}`),

  // Mutations
  create:   (req: CreateStockRequestRequest)               => apiClient.post<StockRequestDto>('/api/stock-requests', req),
  update:   (id: string, req: UpdateStockRequestRequest)   => apiClient.put<StockRequestDto>(`/api/stock-requests/${id}`, req),
  approve:  (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/approve`),
  reject:   (id: string, req: RejectRequest)               => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/reject`, req),
  revoke:   (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/revoke`),
  dispatch: (id: string, req: DispatchRequest)             => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/dispatch`, req),
  receive:  (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/receive`),
  cancel:   (id: string)                                   => apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/cancel`),

  // Shop draft (ShopUser) — at most one live draft per shop, identified
  // by the shop_id on the JWT. No URL id needed.
  getDraft:    ()                                          => apiClient.get<StockRequestDto>('/api/stock-requests/draft'),
  saveDraft:   (req: CreateStockRequestRequest)            => apiClient.post<StockRequestDto>('/api/stock-requests/draft', req),
  deleteDraft: ()                                          => apiClient.delete<void>('/api/stock-requests/draft'),

  // Inventory dispatch draft (Inventory/Admin) — same payload shape as the
  // finalising dispatch endpoint; writes to draft_dispatched_qty only.
  saveDispatchDraft: (id: string, req: DispatchRequest)    =>
    apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/dispatch-draft`, req),

  // Discard the dispatch draft — clears every item's draft_dispatched_qty
  // AND the draft_name label.
  clearDispatchDraft: (id: string) =>
    apiClient.delete<StockRequestDto>(`/api/stock-requests/${id}/dispatch-draft`),

  // Set / clear the godown's free-text label on a saved dispatch draft.
  // Empty / whitespace-only name clears the existing label.
  renameDispatchDraft: (id: string, req: RenameDispatchDraftRequest) =>
    apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/dispatch-draft-name`, req),

  // Pin / unpin a saved dispatch draft so it sorts to the top of the
  // resume strip. Re-pinning bumps the timestamp (re-prioritises).
  pinDispatchDraft: (id: string, req: PinDispatchDraftRequest) =>
    apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/dispatch-draft-pin`, req),

  // Incoming requests with a saved dispatch draft (Inventory/Admin) — drives
  // the "Resume dispatch draft" strip on the inventory list page.
  dispatchDrafts: (inventoryId?: string) =>
    apiClient.get<StockRequestDto[]>(
      `/api/stock-requests/dispatch-drafts${inventoryId ? `?inventoryId=${inventoryId}` : ''}`,
    ),

  // ── Return Stock ─────────────────────────────────────────────
  // Shop user creates a Return (items back to godown). sourceRequestId is
  // optional; when provided, BE validates it's a Received Order belonging
  // to the same shop.
  createReturn: (req: CreateReturnRequest) =>
    apiClient.post<StockRequestDto>('/api/stock-requests/return', req),

  // Inventory/Admin accepts a Pending Return — terminal "Accepted".
  acceptReturn: (id: string, req: AcceptReturnRequest) =>
    apiClient.patch<StockRequestDto>(`/api/stock-requests/${id}/accept`, req),

  // Admin amends an item's dispatched_qty after the request is Received
  // (Orders) or Accepted (Returns). Every call appends an audit row.
  editDispatchedQty: (requestId: string, itemId: string, req: EditDispatchedQtyRequest) =>
    apiClient.patch<StockRequestDto>(
      `/api/stock-requests/${requestId}/items/${itemId}/dispatched-qty`,
      req,
    ),
}
