namespace KovilpattiSnacks.Business.DTOs.VendorPurchases;

// No VendorId/GodownId here — same rationale as StockRequest's Update:
// re-pointing a purchase to a different vendor/godown after creation is
// a "cancel and re-create" operation, not an edit. Only allowed while the
// purchase is still 'Ordered' (enforced by fn_vendor_purchase_update).
public record UpdateVendorPurchaseRequest(
    string InvoiceNumber,
    DateOnly InvoiceDate,
    decimal InvoiceAmount,
    string? Notes,
    IReadOnlyList<CreateVendorPurchaseItem> Items
);
