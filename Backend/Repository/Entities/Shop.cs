namespace KovilpattiSnacks.Repository.Entities;

public class Shop
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string Address { get; set; } = default!;
    public string ContactPhone1 { get; set; } = default!;
    public string? ContactPhone2 { get; set; }
    public string? Gstin { get; set; }
    public Guid InventoryId { get; set; }
    public string InventoryName { get; set; } = default!;
    public bool Active { get; set; }
    // 19-Jun-2026 (client #15): per-shop GST flag. Driven by AdminSettings
    // per-shop toggle when the global gst_enabled app-setting is true.
    public bool GstEnabled { get; set; }
}
