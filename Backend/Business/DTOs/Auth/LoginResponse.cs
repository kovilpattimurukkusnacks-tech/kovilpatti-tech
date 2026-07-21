namespace KovilpattiSnacks.Business.DTOs.Auth;

public record LoginResponse(
    string Token,
    DateTimeOffset ExpiresAt,
    // Opaque refresh token — the client stores this and calls /auth/refresh to
    // obtain a fresh access token when the current one expires. Rotated on
    // every refresh.
    string RefreshToken,
    Guid UserId,
    string Username,
    string FullName,
    string Role,
    Guid? ShopId,
    Guid? InventoryId
);
