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
    public bool Active { get; set; }
}
