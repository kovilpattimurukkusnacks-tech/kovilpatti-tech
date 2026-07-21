using System.Security.Cryptography;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Helpers for the opaque refresh token. The raw token is a 256-bit
/// cryptographically-random value handed to the client; the DB only ever
/// stores its SHA-256 hash, so a DB leak can't yield usable tokens.
/// </summary>
public static class RefreshTokenUtil
{
    /// A new URL-safe raw refresh token (256 bits of entropy).
    public static string NewRawToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        // URL-safe base64 without padding — safe to store/transport verbatim.
        return Convert.ToBase64String(bytes)
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    /// SHA-256 hex of the raw token — this is what gets persisted / looked up.
    public static string Hash(string rawToken)
    {
        var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
