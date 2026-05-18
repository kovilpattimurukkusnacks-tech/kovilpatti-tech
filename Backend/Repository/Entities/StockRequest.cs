namespace KovilpattiSnacks.Repository.Entities;

/// Header row joined with shop + inventory (codes + names) so list and detail
/// views don't have to re-join in C#. `ItemsJson` is only populated by the
/// detail proc (`fn_request_get`) — it's the JSONB aggregate column.
public class StockRequest
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;

    public Guid Shop_Id { get; set; }
    public string Shop_Code { get; set; } = default!;
    public string Shop_Name { get; set; } = default!;

    public Guid Inventory_Id { get; set; }
    public string Inventory_Code { get; set; } = default!;
    public string Inventory_Name { get; set; } = default!;

    /// Full name of the user who first created the request. Null if deleted.
    public string? Submitted_By_Name { get; set; }
    /// Admin who approved this request. Null pre-approval / for rejected requests.
    public string? Approved_By_Name { get; set; }
    /// Inventory user who marked the request Dispatched. Null pre-dispatch.
    public string? Dispatched_By_Name { get; set; }
    /// Shop user who confirmed receipt. Null until the request is Received.
    public string? Received_By_Name { get; set; }

    public string Status { get; set; } = default!;     // 'Pending' | 'Approved' | ...
    public int Total_Items { get; set; }
    public int Total_Qty { get; set; }
    // Sum of dispatched_qty across items — NULL until inventory dispatches.
    public int? Total_Dispatched_Qty { get; set; }
    public decimal Total_Amount { get; set; }
    // Sum of (dispatched_qty × unit_price) across items — NULL until dispatch.
    public decimal? Total_Dispatched_Amount { get; set; }

    public string? Notes { get; set; }
    public string? Rejection_Reason { get; set; }

    public DateTimeOffset Editable_Until { get; set; }
    public DateTimeOffset Submitted_At { get; set; }

    public DateTimeOffset? Approved_At { get; set; }
    public Guid?           Approved_By { get; set; }
    public DateTimeOffset? Dispatched_At { get; set; }
    public Guid?           Dispatched_By { get; set; }
    public DateTimeOffset? Received_At { get; set; }
    public DateTimeOffset? Cancelled_At { get; set; }
    public Guid?           Cancelled_By { get; set; }

    /// Only populated by fn_request_get. Null for list rows.
    public string? Items { get; set; }
}
