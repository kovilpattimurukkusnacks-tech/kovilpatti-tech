using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Auth;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Business.Settings;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class AuthService(
    IUserRepository users,
    IRefreshTokenRepository refreshTokens,
    IPasswordHasher hasher,
    IJwtTokenGenerator tokenGen,
    IValidator<LoginRequest> validator,
    IMemoryCache cache,
    IHttpContextAccessor httpAccessor,
    IOptions<JwtSettings> jwtOptions,
    ILogger<AuthService> logger
) : IAuthService
{
    private readonly int _refreshExpiryDays = jwtOptions.Value.RefreshTokenExpiryDays;
    // Constant-time-defence dummy. Generated once at type init so an attacker
    // can't measure the difference between "user not found" (no BCrypt) and
    // "wrong password" (BCrypt runs against the real hash). Now BCrypt always
    // runs against SOMETHING, so the response time is roughly equal in both
    // failure modes. workFactor matches production (10).
    private static readonly string DummyHash =
        BCrypt.Net.BCrypt.HashPassword("constant-time-defence", workFactor: 10);

    // Per-IP failed-login budget. Successful logins do NOT consume budget;
    // they clear it. 10 failures within 5 min from one IP → blocked for the
    // remainder of the window. BCrypt's 200ms/attempt cost is the real
    // brute-force ceiling; the 5-min window is tuned for typo recovery.
    private const int    MaxFailedAttempts = 10;
    private static readonly TimeSpan FailWindow = TimeSpan.FromMinutes(5);
    private const string FailKeyPrefix = "login-fail:";

    public async Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        // Trim the username — Android keyboards and password managers often
        // append an invisible trailing space, and users can't see it. Don't
        // trim the password; whitespace inside a password is user-chosen.
        var username = request.Username?.Trim() ?? string.Empty;

        var ipKey = FailKeyPrefix + (httpAccessor.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "unknown");

        // Block first, before any BCrypt work — an attacker over the budget
        // gets a fast 429, not a 200ms BCrypt round-trip per attempt.
        if (cache.TryGetValue<int>(ipKey, out var failCount) && failCount >= MaxFailedAttempts)
        {
            logger.LogWarning("Login blocked for IP '{Ip}' — failed-attempt budget exhausted ({Count})",
                httpAccessor.HttpContext?.Connection.RemoteIpAddress, failCount);
            throw new TooManyRequestsException(
                "Too many failed login attempts. Please wait a few minutes and try again.");
        }

        var user = await users.FindByUsernameAsync(username, ct);

        // Always run BCrypt — when the username doesn't exist, run it against a
        // dummy hash so the response time doesn't reveal which usernames exist.
        var hashToCheck = user?.PasswordHash ?? DummyHash;
        var passwordOk  = hasher.Verify(request.Password, hashToCheck);

        if (user is null || !user.Active || !passwordOk)
        {
            // Increment the per-IP failure counter on EVERY failure mode (missing
            // user, inactive, wrong password). Absolute 15-min TTL — counter resets
            // automatically when the window expires.
            var next = failCount + 1;
            cache.Set(ipKey, next, FailWindow);

            // Same warning for all failure modes — never log which one it was,
            // that would leak username existence.
            logger.LogWarning("Login failed for username '{Username}' ({FailCount}/{Max} from this IP)",
                username, next, MaxFailedAttempts);
            throw new UnauthorizedException("Invalid username or password.");
        }

        // Successful login — clear the IP's failure budget so legit users with
        // a typo earlier in the session don't carry penalty forward.
        cache.Remove(ipKey);

        logger.LogInformation("Login succeeded for user {UserId} ({Username})", user.Id, user.Username);

        var refreshToken = await IssueRefreshTokenAsync(user.Id, ct);
        return BuildResponse(user, refreshToken);
    }

    public async Task<LoginResponse> RefreshAsync(RefreshRequest request, CancellationToken ct = default)
    {
        var presented = request.RefreshToken?.Trim();
        if (string.IsNullOrEmpty(presented))
            throw new UnauthorizedException("Session expired. Please sign in again.");

        // Rotate: the old token is validated + revoked and a new one issued in a
        // single SP call. A null result means the token was unknown, expired,
        // already used (reuse → whole family revoked), or the user is disabled.
        var newRaw     = RefreshTokenUtil.NewRawToken();
        var newExpires = DateTimeOffset.UtcNow.AddDays(_refreshExpiryDays);
        var user = await refreshTokens.RotateAsync(
            RefreshTokenUtil.Hash(presented), RefreshTokenUtil.Hash(newRaw), newExpires, ct);

        if (user is null)
        {
            logger.LogWarning("Refresh rejected — invalid/expired/revoked refresh token.");
            throw new UnauthorizedException("Session expired. Please sign in again.");
        }

        logger.LogInformation("Access token refreshed for user {UserId} ({Username})", user.Id, user.Username);
        return BuildResponse(user, newRaw);
    }

    public async Task LogoutAsync(LogoutRequest request, CancellationToken ct = default)
    {
        var presented = request.RefreshToken?.Trim();
        if (string.IsNullOrEmpty(presented)) return;   // nothing to revoke
        await refreshTokens.RevokeAsync(RefreshTokenUtil.Hash(presented), ct);
    }

    // Issue a fresh refresh token: hand the raw value to the caller, store only
    // its hash.
    private async Task<string> IssueRefreshTokenAsync(Guid userId, CancellationToken ct)
    {
        var raw = RefreshTokenUtil.NewRawToken();
        var expires = DateTimeOffset.UtcNow.AddDays(_refreshExpiryDays);
        await refreshTokens.IssueAsync(userId, RefreshTokenUtil.Hash(raw), expires, ct);
        return raw;
    }

    private LoginResponse BuildResponse(User user, string refreshToken)
    {
        var (token, expiresAt) = tokenGen.Generate(user);
        return new LoginResponse(
            Token: token,
            ExpiresAt: expiresAt,
            RefreshToken: refreshToken,
            UserId: user.Id,
            Username: user.Username,
            FullName: user.FullName,
            Role: user.Role.ToString(),
            ShopId: user.ShopId,
            InventoryId: user.InventoryId
        );
    }
}
