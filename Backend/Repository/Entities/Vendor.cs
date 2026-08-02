namespace KovilpattiSnacks.Repository.Entities;

public class Vendor
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string? Gstin { get; set; }
    // 2-digit GST state code (e.g. '33' = Tamil Nadu) — not a free-text
    // state name. Drives is_interstate on vendor_purchases.
    public string? StateCode { get; set; }
    public string? Address { get; set; }
    public string? ContactPerson { get; set; }
    public string? ContactPhone { get; set; }
    public string? Email { get; set; }
    public bool Active { get; set; }
}
