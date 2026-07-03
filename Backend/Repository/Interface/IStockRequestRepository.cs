using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IStockRequestRepository
{
    Task<(List<StockRequest> Rows, long Total)> ListPagedAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        CancellationToken ct = default);

    Task<StockRequest?> GetAsync(Guid id, CancellationToken ct = default);

    Task<IReadOnlyList<CumulativePendingLine>> GetPendingCumulativeAsync(
        Guid? inventoryId,
        IReadOnlyList<Guid>? requestIds = null,
        CancellationToken ct = default);

    Task<IReadOnlyList<ShopRequestCount>> GetCountByShopAsync(
        string? status, Guid? inventoryId,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        CancellationToken ct = default);

    Task<string> NextCodeAsync(CancellationToken ct = default);

    Task<Guid> CreateAsync(
        string code, Guid shopId, Guid inventoryId,
        DateTimeOffset editableUntil, string? notes,
        string itemsJson, Guid userId,
        CancellationToken ct = default);

    Task<bool> UpdateAsync(Guid id, string? notes, string itemsJson, Guid userId, CancellationToken ct = default);

    Task<bool> ApproveAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> RejectAsync(Guid id, Guid userId, string reason, CancellationToken ct = default);
    Task<bool> RevokeAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> DispatchAsync(Guid id, Guid userId, string dispatchedItemsJson, CancellationToken ct = default);
    Task<bool> ReceiveAsync(Guid id, Guid userId, string? itemsJson = null, CancellationToken ct = default);
    Task<bool> CancelAsync(Guid id, Guid userId, CancellationToken ct = default);

    // ── Shop drafts (single live draft per shop, status='Draft') ──
    Task<Guid> SaveShopDraftAsync(Guid shopId, Guid inventoryId, string? notes, string itemsJson, Guid userId, CancellationToken ct = default);
    Task<StockRequest?> GetShopDraftAsync(Guid shopId, CancellationToken ct = default);
    Task<bool> DeleteShopDraftAsync(Guid shopId, CancellationToken ct = default);

    // ── Return Stock (request_type = 'Return') ──
    /// Create a Return — shop user sends items BACK to the godown. Optional
    /// source_request_id links the Return to the Order it reverses (Phase 3
    /// accounts uses this to find the original posting to reverse).
    Task<Guid> CreateReturnAsync(
        string code, Guid shopId, Guid inventoryId,
        Guid? sourceRequestId, string? notes,
        string itemsJson, Guid userId,
        CancellationToken ct = default);

    /// Inventory accepts a Pending Return — sets status='Accepted' + audit
    /// timestamps. Items JSON shape: [{ id, dispatched_qty }] (the same
    /// column is reused; the BE/FE label it "accepted_qty" on a Return).
    Task<bool> AcceptReturnAsync(Guid id, Guid userId, string itemsJson, CancellationToken ct = default);

    // ── Admin post-completion qty edit (client #9, 28-May-2026) ──
    /// Amend an item's dispatched_qty after the request is Received (Orders)
    /// or Accepted (Returns). Writes a row to stock_request_qty_audits so
    /// Phase 3 accounts can reconcile. `newQty` = null clears the value;
    /// otherwise must be >= 0. Returns false when the SP-side guards
    /// (status, bounds, missing item) reject the call.
    Task<bool> EditDispatchedQtyAsync(
        Guid itemId, int? newQty, string? reason, Guid userId, CancellationToken ct = default);

    // ── Inventory dispatch draft (WIP dispatch_qtys saved to draft_dispatched_qty) ──
    Task<bool> SaveDispatchDraftAsync(Guid id, Guid userId, string itemsJson, CancellationToken ct = default);

    /// Clear all draft_dispatched_qty on a request — inventory's discard path.
    /// Also nulls the draft_name label (paired lifecycle).
    Task<bool> ClearDispatchDraftAsync(Guid id, Guid userId, CancellationToken ct = default);

    /// Set / clear the godown's free-text label on a saved dispatch draft.
    /// `name` should already be trimmed + null-emptied by the caller — pass
    /// NULL to clear, any string to set.
    Task<bool> RenameDispatchDraftAsync(Guid id, Guid userId, string? name, CancellationToken ct = default);

    /// Pin / unpin a saved dispatch draft. Pass `pinned=true` to pin
    /// (SP sets pinned_at = now()), `pinned=false` to unpin (clears pinned_at).
    Task<bool> PinDispatchDraftAsync(Guid id, Guid userId, bool pinned, CancellationToken ct = default);

    /// Inventory appends items to a Pending/Approved request. `itemsJson`
    /// is a JSON array of { product_id, requested_qty }.
    Task<bool> InventoryAddItemsAsync(Guid id, Guid userId, string itemsJson, CancellationToken ct = default);

    /// Inventory removes a single inv-added line by item id.
    Task<bool> InventoryRemoveItemAsync(Guid id, Guid itemId, Guid userId, CancellationToken ct = default);

    /// List of Pending/Approved requests in this inventory that have at least
    /// one item with draft_dispatched_qty set. Header-shaped (no items JSON).
    Task<IReadOnlyList<StockRequest>> ListInventoryDispatchDraftsAsync(
        Guid? inventoryId, CancellationToken ct = default);

    // ── Back-order (02-Jul-2026) ──────────────────────────────────
    /// Carve items off a parent Order into a linked Backorder sibling.
    /// `itemsJson` is [{id, qty}, ...]. When qty < parent line's requested_qty
    /// the SP splits the row (partial move); when qty >= requested_qty the
    /// whole row is reparented. SP guards: parent must be Order + Pending/
    /// Approved, every id must belong to parent. Returns the new Backorder's id.
    Task<Guid> MoveToBackorderAsync(
        Guid id, string itemsJson, DateTimeOffset? expectedArrivalAt,
        Guid userId, CancellationToken ct = default);

    /// Pipeline snapshot of Pending Backorders. inventoryId scopes to a
    /// godown (Inventory role forced server-side by the service layer);
    /// shopIds scopes to a shop set (used by shop banner). Never date-filtered
    /// — the strip must show cross-month back-orders until they close.
    Task<IReadOnlyList<OutstandingBackorderRow>> ListOutstandingBackordersAsync(
        Guid? inventoryId, IReadOnlyList<Guid>? shopIds,
        CancellationToken ct = default);
}

/// Read-only row shape for fn_request_list_outstanding_backorders. Kept
/// separate from the StockRequest entity because this SP projects a
/// pipeline summary (parent link + days-waiting) — not a full request.
public class OutstandingBackorderRow
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;
    public Guid? Parent_Id { get; set; }
    public string? Parent_Code { get; set; }
    public Guid Shop_Id { get; set; }
    public string Shop_Code { get; set; } = default!;
    public string Shop_Name { get; set; } = default!;
    public Guid Inventory_Id { get; set; }
    public string Inventory_Name { get; set; } = default!;
    public int Total_Items { get; set; }
    public int Total_Qty { get; set; }
    public decimal Total_Amount { get; set; }
    public DateTimeOffset Submitted_At { get; set; }
    public DateTimeOffset? Expected_Arrival_At { get; set; }
    public int Days_Since_Submitted { get; set; }
}
