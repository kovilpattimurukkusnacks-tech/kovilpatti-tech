namespace KovilpattiSnacks.Repository.Entities;

public class Product
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;
    public string Name { get; set; } = default!;
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = default!;
    public string Type { get; set; } = default!;
    public decimal? WeightValue { get; set; }
    public string? WeightUnit { get; set; }
    public decimal Mrp { get; set; }
    public decimal PurchasePrice { get; set; }
    // Hidden in the UI for now; persisted as percent (0..100), nullable.
    public decimal? Gst { get; set; }
    public bool Active { get; set; }
    /// True when this SKU is procured from a vendor (not made in-house).
    /// Godown pre-checks vendor-procured lines in the Move-to-back-order
    /// dialog so shop can be told what's on order from suppliers.
    public bool IsVendorProcured { get; set; }
}
