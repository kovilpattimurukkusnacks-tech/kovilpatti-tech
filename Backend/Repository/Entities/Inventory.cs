namespace KovilpattiSnacks.Repository.Entities;

public class Inventory
{
    public Guid Id { get; set; }
    public string Code { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string Address { get; set; } = default!;
    public string ContactPhone { get; set; } = default!;
    public string? ContactPersonName { get; set; }
    public bool Active { get; set; }
}
