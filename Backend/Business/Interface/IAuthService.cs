using KovilpattiSnacks.Business.DTOs.Auth;

namespace KovilpattiSnacks.Business.Interface;

public interface IAuthService
{
    Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken ct = default);

    /// Exchange a valid refresh token for a fresh access token (+ rotated
    /// refresh token). Throws UnauthorizedException when the refresh token is
    /// invalid / expired / revoked.
    Task<LoginResponse> RefreshAsync(RefreshRequest request, CancellationToken ct = default);

    /// Revoke a refresh token (logout). Best-effort; never throws for an
    /// unknown token.
    Task LogoutAsync(LogoutRequest request, CancellationToken ct = default);
}
