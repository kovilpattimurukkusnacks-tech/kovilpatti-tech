namespace KovilpattiSnacks.Repository.Entities;

/// Header row joined with vendor + godown (code/name) so list and detail
/// views don't have to re-join in C#. `Items` is only populated by the
/// detail proc (`fn_vendor_purchase_get`) — the JSONB aggregate column,
/// same pattern as StockRequest.Items.
public class VendorPurchase
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;

    public Guid Vendor_Id { get; set; }
    public string Vendor_Code { get; set; } = default!;
    public string Vendor_Name { get; set; } = default!;

    public Guid Godown_Id { get; set; }
    public string Godown_Code { get; set; } = default!;
    public string Godown_Name { get; set; } = default!;

    public bool Is_Interstate { get; set; }
    public string Invoice_Number { get; set; } = default!;
    public DateOnly Invoice_Date { get; set; }
    public decimal Invoice_Amount { get; set; }

    public string Status { get; set; } = default!;   // 'Ordered' | 'Received'

    public int Total_Items { get; set; }
    public decimal Total_Qty { get; set; }
    public decimal Total_Amount { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset? Received_At { get; set; }
    public string? Received_By_Name { get; set; }

    public DateTimeOffset Created_At { get; set; }

    /// Phase 5b — 'NotRequired' | 'Attached' | 'Missing'. Populated only by
    /// fn_vendor_purchase_list_paged (list rows); the detail SP leaves this
    /// null since the detail page renders the full e-way section instead.
    public string? Eway_Status { get; set; }

    /// Only populated by fn_vendor_purchase_get. Null for list rows.
    public string? Items { get; set; }
}
