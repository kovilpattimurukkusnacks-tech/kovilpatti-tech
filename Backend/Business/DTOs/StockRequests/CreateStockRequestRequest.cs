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
    IReadOnlyList<CreateStockRequestItem> Items
) : IStockRequestPayload;

public record CreateStockRequestItem(
    Guid ProductId,
    int  RequestedQty
);

public record UpdateStockRequestRequest(
    string? Notes,
    IReadOnlyList<CreateStockRequestItem> Items
) : IStockRequestPayload;

public record RejectRequest(string Reason);

public record DispatchRequest(IReadOnlyList<DispatchItem> Items);

public record DispatchItem(
    Guid Id,           // stock_request_items.id
    int  DispatchedQty
);

/// Inventory user renames a saved dispatch draft. Empty / whitespace-only
/// Name clears the existing name (BE trims + null-empties before the SP).
public record RenameDispatchDraftRequest(string? Name);

/// Pin / unpin a saved dispatch draft so it sorts to the top of the resume
/// strip. Re-pinning a pinned draft bumps the timestamp (re-prioritises).
public record PinDispatchDraftRequest(bool Pinned);
