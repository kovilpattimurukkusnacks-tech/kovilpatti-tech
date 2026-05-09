namespace KovilpattiSnacks.Business.DTOs.Shops;

public record ShopDto(
    Guid Id,
    string Code,
    string Name,
    string Address,
    string ContactPhone1,
    string? ContactPhone2,
    string? Gstin,
    Guid InventoryId,
    string InventoryName,
    bool Active
);
