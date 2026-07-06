namespace KovilpattiSnacks.Business.DTOs.Products;

// Shared shape between Create and Update payloads. Drives one validator base
// class so the 7 common rules aren't copy-pasted.
public interface IProductPayload
{
    string Name { get; }
    int CategoryId { get; }
    string Type { get; }
    decimal? WeightValue { get; }
    string? WeightUnit { get; }
    decimal Mrp { get; }
    decimal PurchasePrice { get; }
    decimal? Gst { get; }
    bool Active { get; }
}

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
) : IProductPayload;
