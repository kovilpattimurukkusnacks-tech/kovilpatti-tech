namespace KovilpattiSnacks.Repository.Entities;

public class User
{
    public Guid Id { get; set; }
    public string Username { get; set; } = default!;
    public string PasswordHash { get; set; } = default!;
    public string FullName { get; set; } = default!;
    public UserRole Role { get; set; }
    public Guid? ShopId { get; set; }
    public string? ShopName { get; set; }
    public Guid? InventoryId { get; set; }
    public string? InventoryName { get; set; }
    public bool Active { get; set; }
}
