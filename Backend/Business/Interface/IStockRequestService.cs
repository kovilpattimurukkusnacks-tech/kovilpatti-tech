using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Interface;

public interface IStockRequestService
{
    Task<PagedResult<StockRequestDto>> ListAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        CancellationToken ct = default);

    Task<StockRequestDto> GetAsync(Guid id, CancellationToken ct = default);

    /// Cumulative-pending workload, scoped by role: inventory user → own
    /// inventory; admin → may pass an inventoryId to scope, or NULL for
    /// tenant-wide totals; shop user → ForbiddenException.
    Task<IReadOnlyList<CumulativePendingLineDto>> GetPendingCumulativeAsync(
        Guid? inventoryId, CancellationToken ct = default);

    /// Per-shop request counts for a given status filter (NULL = all). Used
    /// by the list page's shop quick-filter chips. Inventory role scoped to
    /// own inventory; admin may pass inventoryId or NULL; shop user blocked.
    Task<IReadOnlyList<ShopRequestCountDto>> GetCountByShopAsync(
        string? status, Guid? inventoryId,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        CancellationToken ct = default);

    Task<StockRequestDto> CreateAsync(CreateStockRequestRequest request, CancellationToken ct = default);
    Task<StockRequestDto> UpdateAsync(Guid id, UpdateStockRequestRequest request, CancellationToken ct = default);

    Task<StockRequestDto> ApproveAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> RejectAsync(Guid id, RejectRequest request, CancellationToken ct = default);
    Task<StockRequestDto> RevokeAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> DispatchAsync(Guid id, DispatchRequest request, CancellationToken ct = default);
    Task<StockRequestDto> ReceiveAsync(Guid id, CancellationToken ct = default);
    Task<StockRequestDto> CancelAsync(Guid id, CancellationToken ct = default);

    // ── Return Stock ──
    /// Shop user creates a Return (items back to godown). SourceRequestId
    /// is optional — when provided, links to the Order being reversed so
    /// Phase 3 accounts can post a precise reverse entry.
    Task<StockRequestDto> CreateReturnAsync(CreateReturnRequest request, CancellationToken ct = default);

    /// Inventory user / Admin accepts a Pending Return (terminal state).
    /// Per-item accepted qty allowed (partial accept).
    Task<StockRequestDto> AcceptReturnAsync(Guid id, AcceptReturnRequest request, CancellationToken ct = default);

    // ── Admin post-completion qty edit (client #9) ──
    /// Amend an item's dispatched_qty after the request is Received (Orders)
    /// or Accepted (Returns). Admin-only. Writes a row to the qty-audit
    /// table that Phase 3 accounts consumes. Returns the refreshed parent
    /// request so caches stay in sync.
    Task<StockRequestDto> EditDispatchedQtyAsync(
        Guid requestId, Guid itemId, EditDispatchedQtyRequest request, CancellationToken ct = default);

    // ── Shop drafts (ShopUser only) ──
    /// Save (or replace) the shop user's single live draft.
    Task<StockRequestDto> SaveShopDraftAsync(CreateStockRequestRequest request, CancellationToken ct = default);
    /// Get the shop user's current draft. Returns null when none exists.
    Task<StockRequestDto?> GetShopDraftAsync(CancellationToken ct = default);
    /// Discard the shop user's draft. Returns true if a draft was deleted.
    Task<bool> DeleteShopDraftAsync(CancellationToken ct = default);

    // ── Inventory dispatch draft (Inventory/Admin) ──
    /// Save WIP dispatch quantities without finalising. Pre-fills the dispatch
    /// screen when the user returns. Cleared when the dispatch is finalised.
    Task<StockRequestDto> SaveDispatchDraftAsync(Guid id, DispatchRequest request, CancellationToken ct = default);

    /// Discard the saved dispatch draft on a request (clears draft_dispatched_qty
    /// on every item AND the draft_name label). Returns the refreshed request
    /// DTO so caches stay in sync.
    Task<StockRequestDto> ClearDispatchDraftAsync(Guid id, CancellationToken ct = default);

    /// Set / clear the godown's free-text label on a saved dispatch draft
    /// (30-Jun-2026). Empty / whitespace-only Name clears the existing label.
    /// Same inventory-scope rule as SaveDispatchDraftAsync; status must still
    /// be Pending or Approved. Returns the refreshed request DTO.
    Task<StockRequestDto> RenameDispatchDraftAsync(
        Guid id, RenameDispatchDraftRequest request, CancellationToken ct = default);

    /// Pin / unpin a saved dispatch draft. Pinned drafts sort to the top of
    /// the resume strip. Same inventory-scope + Pending/Approved guards as
    /// the other draft SPs. Returns the refreshed request DTO so caches
    /// stay in sync.
    Task<StockRequestDto> PinDispatchDraftAsync(
        Guid id, PinDispatchDraftRequest request, CancellationToken ct = default);

    /// Inventory / Admin appends new product lines to a Pending or Approved
    /// request. Each new row is tagged added_by = 'Inventory'. SP rejects
    /// duplicates (product already in the request). Returns the refreshed
    /// DTO so caches stay in sync. 01-Jul-2026.
    Task<StockRequestDto> InventoryAddItemsAsync(
        Guid id, InventoryAddItemsRequest request, CancellationToken ct = default);

    /// Inventory / Admin removes an inv-added line they appended by mistake.
    /// Shop-added items are protected server-side (SP only deletes rows
    /// with added_by = 'Inventory').
    Task<StockRequestDto> InventoryRemoveItemAsync(
        Guid id, Guid itemId, CancellationToken ct = default);

    /// List of incoming requests (Pending/Approved) that have a saved
    /// dispatch draft on at least one item. Inventory role scoped to own
    /// inventory; admin may pass inventoryId or NULL for tenant-wide;
    /// shop user blocked.
    Task<IReadOnlyList<StockRequestDto>> ListInventoryDispatchDraftsAsync(
        Guid? inventoryId, CancellationToken ct = default);

    // ── Back-order (02-Jul-2026) ──
    /// Godown carves selected items off a parent Order into a linked
    /// Backorder sibling. Returns the parent Order's refreshed DTO —
    /// the child's DTO is embedded in ParentBackorderChildren[]. Callers
    /// that need the new child directly should GET /{newBackorderId}.
    Task<StockRequestDto> MoveToBackorderAsync(
        Guid id, MoveToBackorderRequest request, CancellationToken ct = default);

    /// Pipeline-scoped list of Pending Backorders. Never date-filtered so
    /// the strip stays visible across month boundaries. Role-scoped:
    /// ShopUser → forced to own shop; Inventory → forced to own godown;
    /// Admin → tenant-wide (or optional inventoryId filter).
    Task<IReadOnlyList<OutstandingBackorderDto>> ListOutstandingBackordersAsync(
        Guid? inventoryId, CancellationToken ct = default);
}
