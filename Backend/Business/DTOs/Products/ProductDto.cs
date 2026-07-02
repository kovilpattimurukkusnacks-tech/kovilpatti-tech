namespace KovilpattiSnacks.Business.DTOs.Products;

public record ProductDto(
    Guid Id,
    string Code,
    string Name,
    int CategoryId,
    string CategoryName,
    string Type,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal? PurchasePrice,
    // GST rate (percent). Hidden in the UI for now; surfaced later.
    decimal? Gst,
    bool Active,
    /// True when this SKU is procured from a vendor (not made in-house).
    /// Drives the "vendor-procured" badge on the products grid and the
    /// pre-check in the Move-to-back-order dialog.
    bool IsVendorProcured
);
