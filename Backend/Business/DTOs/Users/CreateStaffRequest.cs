namespace KovilpattiSnacks.Business.DTOs.Users;

public record CreateStaffRequest(
    string Username,
    string Password,
    string FullName,
    string Role,            // "ShopUser" or "Inventory"
    Guid? ShopId,
    Guid? InventoryId,
    bool Active = true
);
