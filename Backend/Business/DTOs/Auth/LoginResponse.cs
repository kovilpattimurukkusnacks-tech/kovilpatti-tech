namespace KovilpattiSnacks.Business.DTOs.Auth;

public record LoginResponse(
    string Token,
    DateTimeOffset ExpiresAt,
    Guid UserId,
    string Username,
    string FullName,
    string Role,
    Guid? ShopId,
    Guid? InventoryId
);
