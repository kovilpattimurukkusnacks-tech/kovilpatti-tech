namespace KovilpattiSnacks.Business.DTOs.Shops;

public record CreateShopRequest(
    string? Code,
    string Name,
    string Address,
    string ContactPhone1,
    string? ContactPhone2,
    string? Gstin,
    Guid InventoryId,
    bool Active = true,
    /// 19-Jun-2026 (client #15): per-shop GST flag. Defaults to true so
    /// new shops opt-in to GST tracking — admin can flip via the
    /// AdminSettings per-shop toggle.
    bool GstEnabled = true
);
