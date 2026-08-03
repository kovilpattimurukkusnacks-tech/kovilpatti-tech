namespace KovilpattiSnacks.Business.DTOs.Products;

public record ProductDto(
    Guid Id,
    string Code,
    // Scannable code for POS billing. Null when not barcoded.
    string? Barcode,
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
    /// 01-Aug-2026 (Phase 4c): admin toggle. When true the POS lets the
    /// cashier pick a weight for this SKU at bill time. Only meaningful
    /// when WeightUnit is 'g' or 'kg' AND WeightValue > 0.
    bool SoldLoose = false
);
