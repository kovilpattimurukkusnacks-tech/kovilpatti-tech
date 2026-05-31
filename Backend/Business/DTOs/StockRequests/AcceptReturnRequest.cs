namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// <summary>
/// Inventory user accepts a Pending Return. Items shape mirrors DispatchRequest
/// (per-item id + qty) but the qty here means "amount the godown actually
/// accepted" — partial accepts are allowed when the physical count differs
/// from what the shop claimed they were sending back.
///
/// Behind the scenes, the SP writes this into the same `dispatched_qty` column
/// that Orders use — semantic reuse, not a separate column.
/// </summary>
public record AcceptReturnRequest(IReadOnlyList<AcceptReturnItem> Items);

public record AcceptReturnItem(
    Guid Id,           // stock_request_items.id
    int  AcceptedQty   // qty the godown accepted (≥ 0)
);
