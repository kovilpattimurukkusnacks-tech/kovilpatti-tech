namespace KovilpattiSnacks.Business.Constants;

/// <summary>
/// Non-standard JWT claim names used by this app. Standard claims (sub, jti,
/// iat, role, etc.) keep their <see cref="System.Security.Claims.ClaimTypes"/>
/// / <see cref="System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames"/>
/// originals — only the app-specific keys are centralised here.
///
/// Single source of truth: the token generator writes these and the
/// CurrentUser reader pulls them by the same constant. Renaming a claim
/// touches one line instead of two files.
/// </summary>
public static class CustomClaims
{
    public const string FullName    = "fullName";
    public const string ShopId      = "shopId";
    public const string InventoryId = "inventoryId";
}
