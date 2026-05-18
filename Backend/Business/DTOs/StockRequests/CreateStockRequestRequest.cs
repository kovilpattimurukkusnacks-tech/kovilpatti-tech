namespace KovilpattiSnacks.Business.DTOs.StockRequests;

public record CreateStockRequestRequest(
    string? Notes,
    IReadOnlyList<CreateStockRequestItem> Items
);

public record CreateStockRequestItem(
    Guid ProductId,
    int  RequestedQty
);

public record UpdateStockRequestRequest(
    string? Notes,
    IReadOnlyList<CreateStockRequestItem> Items
);

public record RejectRequest(string Reason);

public record DispatchRequest(IReadOnlyList<DispatchItem> Items);

public record DispatchItem(
    Guid Id,           // stock_request_items.id
    int  DispatchedQty
);
