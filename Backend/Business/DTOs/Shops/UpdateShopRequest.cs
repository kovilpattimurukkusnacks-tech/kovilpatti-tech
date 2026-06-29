namespace KovilpattiSnacks.Business.DTOs.Shops;

public record UpdateShopRequest(
    string Name,
    string Address,
    string ContactPhone1,
    string? ContactPhone2,
    string? Gstin,
    Guid InventoryId,
    bool Active,
    /// 19-Jun-2026 (client #15): per-shop GST flag.
    bool GstEnabled = true
);
