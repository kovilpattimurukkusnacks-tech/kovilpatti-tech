using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IStockRequestRepository
{
    Task<(List<StockRequest> Rows, long Total)> ListPagedAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        // 15-Jul-2026: opt-in for the admin "My Drafts" preset — when true
        // AND userId is non-null, status='Draft' rows created by that user
        // are included. Both default false / null → identical behaviour
        // for every existing caller.
        bool includeDrafts = false, Guid? userId = null,
        // 15-Jul-2026: is_special filter. NULL = no filter (default),
        // true = specials only, false = non-specials only. Drives the
        // "Special Order" preset chip on all list pages.
        bool? isSpecial = null,
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
        bool isSpecial, string? specialLabel,
        CancellationToken ct = default);

    Task<bool> UpdateAsync(Guid id, string? notes, string itemsJson, Guid userId, CancellationToken ct = default);

    Task<bool> ApproveAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> RejectAsync(Guid id, Guid userId, string reason, CancellationToken ct = default);
    Task<bool> RevokeAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> HoldAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> DispatchAsync(Guid id, Guid userId, string dispatchedItemsJson, CancellationToken ct = default);
    Task<bool> ReceiveAsync(Guid id, Guid userId, string? itemsJson = null, CancellationToken ct = default);
    Task<bool> CancelAsync(Guid id, Guid userId, CancellationToken ct = default);

    // ── Shop drafts (single live draft per shop, status='Draft') ──
    Task<Guid> SaveShopDraftAsync(Guid shopId, Guid inventoryId, string? notes, string itemsJson, Guid userId, CancellationToken ct = default);
    Task<StockRequest?> GetShopDraftAsync(Guid shopId, Guid userId, CancellationToken ct = default);
    Task<bool> DeleteShopDraftAsync(Guid shopId, Guid userId, CancellationToken ct = default);

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

    // ── Special Request (06-Jul-2026) ─────────────────────────────
    /// Toggle the shop-declared "special / vendor procurement" flag on a
    /// Pending request. SP gates status = 'Pending' — once approved the
    /// flag freezes. Label is stored only when isSpecial is true.
    /// Returns false when the id doesn't match a Pending row.
    Task<bool> SetSpecialAsync(
        Guid id, bool isSpecial, string? specialLabel,
        Guid userId, CancellationToken ct = default);

    /// Every un-received Special request in scope. shopId → shop user's
    /// own shop; inventoryId → inventory user's own godown; both NULL →
    /// admin tenant-wide. Powers the sticky top banner across all three
    /// roles. Never date-filtered — banner surfaces cross-month specials
    /// until the shop confirms Received.
    Task<IReadOnlyList<ActiveSpecialRow>> ListActiveSpecialsAsync(
        Guid? shopId, Guid? inventoryId,
        CancellationToken ct = default);
}

/// Row shape for fn_request_list_active_specials (sticky-banner data).
/// Kept separate from the StockRequest entity because the SP projects a
/// pipeline summary (label + days-waiting) — not a full request.
public class ActiveSpecialRow
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;
    public string? Special_Label { get; set; }
    public Guid Shop_Id { get; set; }
    public string Shop_Code { get; set; } = default!;
    public string Shop_Name { get; set; } = default!;
    public Guid Inventory_Id { get; set; }
    public string Inventory_Name { get; set; } = default!;
    public string Status { get; set; } = default!;
    public int Total_Items { get; set; }
    public int Total_Qty { get; set; }
    public decimal Total_Amount { get; set; }
    public DateTimeOffset Submitted_At { get; set; }
    public int Days_Since_Submitted { get; set; }
}
