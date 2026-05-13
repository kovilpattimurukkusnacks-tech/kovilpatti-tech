namespace KovilpattiSnacks.Business.DTOs.Products;

public record UpdateProductRequest(
    string Name,
    int CategoryId,
    string Type,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal PurchasePrice,
    // Optional. Hidden in the FE form for now — left as-is if omitted.
    decimal? Gst,
    bool Active
);
