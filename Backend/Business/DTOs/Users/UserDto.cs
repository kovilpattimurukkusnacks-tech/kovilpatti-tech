namespace KovilpattiSnacks.Business.DTOs.Users;

public record UserDto(
    Guid Id,
    string Username,
    string FullName,
    string Role,
    Guid? ShopId,
    string? ShopName,
    Guid? InventoryId,
    string? InventoryName,
    bool Active
);
