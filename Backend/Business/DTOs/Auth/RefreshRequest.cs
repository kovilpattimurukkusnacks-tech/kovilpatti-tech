namespace KovilpattiSnacks.Business.DTOs.Auth;

/// Body for POST /api/auth/refresh — the client's current refresh token.
public record RefreshRequest(string RefreshToken);

/// Body for POST /api/auth/logout — the refresh token to revoke server-side.
public record LogoutRequest(string RefreshToken);
