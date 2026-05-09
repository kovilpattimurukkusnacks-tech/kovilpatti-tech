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
    bool Active = true
);
