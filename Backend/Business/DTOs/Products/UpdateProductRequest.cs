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
    bool Active,
    // Optional. Null / blank → service keeps the existing code. Non-blank →
    // service re-codes the product after a uniqueness check against OTHER
    // rows. Editable as of 07-Jun-2026 (client #10).
    string? Code = null,
    // Optional scannable code for POS billing (14-Jul-2026). Blank → null
    // (clears the barcode); the SP persists whatever is sent.
    string? Barcode = null
) : IProductPayload;
