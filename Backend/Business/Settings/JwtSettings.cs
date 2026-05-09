namespace KovilpattiSnacks.Business.Settings;

public class JwtSettings
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = default!;
    public string Audience { get; set; } = default!;
    public string SigningKey { get; set; } = default!;
    public int ExpiryMinutes { get; set; } = 480;
}
