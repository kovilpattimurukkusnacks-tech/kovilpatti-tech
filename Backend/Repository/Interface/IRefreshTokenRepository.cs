using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IRefreshTokenRepository
{
    /// Persist a freshly-issued refresh token (only its SHA-256 hash is stored).
    Task<Guid> IssueAsync(Guid userId, string tokenHash, DateTimeOffset expiresAt, CancellationToken ct = default);

    /// Validate + rotate: revoke the old token, issue the new one, and return the
    /// user to mint a fresh access token for. Returns null when the old token is
    /// unknown / expired / already-revoked (reuse) or the user is deactivated.
    Task<User?> RotateAsync(string oldHash, string newHash, DateTimeOffset newExpiresAt, CancellationToken ct = default);

    /// Explicitly revoke a single refresh token (logout). True if a live token was revoked.
    Task<bool> RevokeAsync(string tokenHash, CancellationToken ct = default);
}
