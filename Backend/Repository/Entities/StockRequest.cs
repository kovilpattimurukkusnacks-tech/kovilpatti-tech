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
    /// Shop's primary contact phone (shops.contact_phone_1). Surfaced for the
    /// thermal-print header. Populated by fn_request_get only — null on list
    /// rows since fn_request_list_paged doesn't SELECT it.
    public string? Shop_Contact_Phone { get; set; }

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

    /// Godown-supplied label on a saved dispatch draft. Populated by
    /// fn_request_list_inventory_dispatch_drafts; NULL on every other list
    /// SP today (other endpoints don't surface it, so Dapper leaves this
    /// at its default null — that's fine, the DTO field is nullable too).
    public string? Draft_Name { get; set; }

    /// When the dispatch draft was pinned (NULL = not pinned). Used to
    /// sort pinned drafts above unpinned ones on the resume strip.
    /// Cleared on discard / dispatch alongside Draft_Name.
    public DateTimeOffset? Pinned_At { get; set; }

    /// Backorder-only: the parent Order this Backorder was carved off of.
    /// NULL on Orders / Returns / free-form Backorders. Set by
    /// fn_request_move_to_backorder. Populated by fn_request_get and
    /// fn_request_list_paged; null on other list SPs (they don't SELECT it).
    public Guid?   Parent_Request_Id { get; set; }
    /// Joined from stock_requests on Parent_Request_Id — the parent Order's
    /// code (e.g. "REQ0042"). NULL when Parent_Request_Id is NULL.
    public string? Parent_Request_Code { get; set; }
    /// Backorder-only: godown-supplied "expected arrival" ETA. Nullable —
    /// blank means "no ETA yet". Rendered on all three roles' UIs so shop
    /// knows when to expect the vendor-procured items.
    public DateTimeOffset? Expected_Arrival_At { get; set; }

    /// Only populated by fn_request_get on Order rows that have been carved.
    /// JSON array of `{id, code, status, total_items, total_qty, total_amount,
    /// expected_arrival_at, submitted_at}`. Null on list rows, on rows that
    /// have no backorder children, and on Returns/Backorders themselves.
    public string? Backorder_Children { get; set; }

    /// Only populated by fn_request_get. Null for list rows.
    public string? Items { get; set; }
}
