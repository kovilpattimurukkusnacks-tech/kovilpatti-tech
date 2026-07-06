namespace KovilpattiSnacks.Business.DTOs.StockRequests;

// Common shape for create + update + save-draft payloads. Lets a single
// validator base class drive all three without copy-pasting rules.
public interface IStockRequestPayload
{
    string? Notes { get; }
    IReadOnlyList<CreateStockRequestItem> Items { get; }
}

public record CreateStockRequestRequest(
    string? Notes,
    IReadOnlyList<CreateStockRequestItem> Items,
    /// 06-Jul-2026 (client req): shop flags this whole request as a
    /// vendor-procurement "Special Request" on the review/submit step.
    /// Nullable so pre-rework FE builds that omit the field still POST
    /// cleanly — treated as false.
    bool? IsSpecial = false,
    /// User-supplied label ("Diwali stock 2026"). Ignored when IsSpecial
    /// is false; nullable when IsSpecial is true (UI falls back to
    /// "Special Request").
    string? SpecialLabel = null
) : IStockRequestPayload;

public record CreateStockRequestItem(
    Guid ProductId,
    int  RequestedQty,
    /// Return-only partial-weight claim in grams (02-Jul-2026). Non-null
    /// on Return payloads where the shop is claiming credit for a
    /// fraction of a pack (damage claim). Ignored on Order / draft
    /// payloads by the SPs that consume this shape. Only g/kg SKUs.
    decimal? ReturnWeightG = null
);

public record UpdateStockRequestRequest(
    string? Notes,
    IReadOnlyList<CreateStockRequestItem> Items
) : IStockRequestPayload;

public record RejectRequest(string Reason);

public record DispatchRequest(IReadOnlyList<DispatchItem> Items);

/// DispatchedQty is nullable ONLY for the save-dispatch-draft path:
/// sending null tells the SP to clear this item's persisted draft (the
/// godown erased the qty mid-edit). The final /dispatch endpoint still
/// rejects null via DispatchValidator so the terminal state can't be
/// reached with an unset qty.
public record DispatchItem(
    Guid Id,           // stock_request_items.id
    int? DispatchedQty
);

/// Inventory user renames a saved dispatch draft. Empty / whitespace-only
/// Name clears the existing name (BE trims + null-empties before the SP).
public record RenameDispatchDraftRequest(string? Name);

/// Pin / unpin a saved dispatch draft so it sorts to the top of the resume
/// strip. Re-pinning a pinned draft bumps the timestamp (re-prioritises).
public record PinDispatchDraftRequest(bool Pinned);

/// Inventory user / Admin appends new product lines to a Pending or Approved
/// request (01-Jul-2026 client req — last-minute customer bumps qty just
/// before dispatch). Each row is inserted with added_by = 'Inventory'.
/// The SP rejects duplicates (product already in the request) — the
/// dispatch-qty flow should be used to send more of a shop-included product.
public record InventoryAddItemsRequest(IReadOnlyList<InventoryAddItem> Items);

public record InventoryAddItem(Guid ProductId, int RequestedQty);
