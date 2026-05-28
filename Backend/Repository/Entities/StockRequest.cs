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
    /// Inventory user who accepted a Return. Null for Orders / unaccepted Returns.
    public string? Accepted_By_Name { get; set; }

    public string Status { get; set; } = default!;     // 'Pending' | 'Approved' | 'Accepted' | ...
    /// 'Order' (forward — shop → godown) or 'Return' (reverse — goods back to godown).
    public string Request_Type { get; set; } = default!;
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
    // Set on every row write (via the set_updated_at trigger). For drafts
    // this is the last "Save as Draft" timestamp; for finalised requests
    // it's whenever the row was last touched (status flip, edit, etc.).
    public DateTimeOffset Updated_At { get; set; }

    public DateTimeOffset? Approved_At { get; set; }
    public Guid?           Approved_By { get; set; }
    public DateTimeOffset? Dispatched_At { get; set; }
    public Guid?           Dispatched_By { get; set; }
    public DateTimeOffset? Received_At { get; set; }
    /// Return terminal — when the godown closed the return. NULL on Orders
    /// and unaccepted Returns.
    public DateTimeOffset? Accepted_At { get; set; }
    public Guid?           Accepted_By { get; set; }
    public DateTimeOffset? Cancelled_At { get; set; }
    public Guid?           Cancelled_By { get; set; }

    /// Return-only: the Order this Return reverses. NULL for Orders and
    /// free-form Returns. Accounts (Phase 3) reads this to find the original
    /// posting to reverse.
    public Guid?   Source_Request_Id { get; set; }
    /// Joined from stock_requests on Source_Request_Id — the linked Order's
    /// code (e.g. "REQ0042"). NULL when Source_Request_Id is NULL.
    public string? Source_Request_Code { get; set; }

    /// Only populated by fn_request_get. Null for list rows.
    public string? Items { get; set; }
}
