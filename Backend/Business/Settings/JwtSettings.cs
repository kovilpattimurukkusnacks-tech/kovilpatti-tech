namespace KovilpattiSnacks.Business.Settings;

public class JwtSettings
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = default!;
    public string Audience { get; set; } = default!;
    public string SigningKey { get; set; } = default!;
    // Access-token lifetime. Short with the refresh-token flow in place — the
    // client silently renews via /auth/refresh, so a short access token limits
    // the blast radius of a leaked token without logging active users out.
    public int ExpiryMinutes { get; set; } = 15;
    // Refresh-token lifetime. A user who logs in at least this often never has
    // to re-enter credentials; server-side revocable.
    public int RefreshTokenExpiryDays { get; set; } = 14;
}
