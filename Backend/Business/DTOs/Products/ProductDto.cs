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
    bool Active
);
