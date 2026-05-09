namespace KovilpattiSnacks.Business.DTOs.Users;

public record UpdateStaffRequest(
    string FullName,
    string Role,
    Guid? ShopId,
    Guid? InventoryId,
    bool Active
);
