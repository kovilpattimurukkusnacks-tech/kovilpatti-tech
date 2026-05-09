namespace KovilpattiSnacks.Business.DTOs.Shops;

public record CreateShopRequest(
    string? Code,
    string Name,
    string Address,
    string ContactPhone1,
    string? ContactPhone2,
    string? Gstin,
    Guid InventoryId,
    bool Active = true
);
