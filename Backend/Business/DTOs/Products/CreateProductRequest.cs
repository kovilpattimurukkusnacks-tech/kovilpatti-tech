namespace KovilpattiSnacks.Business.DTOs.Products;

public record CreateProductRequest(
    string? Code,
    string Name,
    int CategoryId,
    string Type,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal PurchasePrice,
    // Optional. Hidden in the FE form for now — defaults to null.
    decimal? Gst = null,
    bool Active = true
);
