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
    bool Active,
    /// 19-Jun-2026 (client #15): per-shop GST flag. Surfaced via the
    /// AdminSettings per-shop toggle when the global gst_enabled
    /// app-setting is true.
    bool GstEnabled
);
