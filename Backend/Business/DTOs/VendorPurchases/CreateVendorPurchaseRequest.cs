namespace KovilpattiSnacks.Business.DTOs.VendorPurchases;

public record CreateVendorPurchaseRequest(
    Guid VendorId,
    Guid GodownId,
    string InvoiceNumber,
    DateOnly InvoiceDate,
    decimal InvoiceAmount,
    string? Notes,
    IReadOnlyList<CreateVendorPurchaseItem> Items
);

public record CreateVendorPurchaseItem(
    Guid ProductId,
    decimal Qty,
    decimal UnitCost
);
