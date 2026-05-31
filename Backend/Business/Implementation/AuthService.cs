using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Auth;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Interface;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class AuthService(
    IUserRepository users,
    IPasswordHasher hasher,
    IJwtTokenGenerator tokenGen,
    IValidator<LoginRequest> validator,
    IMemoryCache cache,
    IHttpContextAccessor httpAccessor,
    ILogger<AuthService> logger
) : IAuthService
{
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

        var user = await users.FindByUsernameAsync(request.Username, ct);

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
                request.Username, next, MaxFailedAttempts);
            throw new UnauthorizedException("Invalid username or password.");
        }

        // Successful login — clear the IP's failure budget so legit users with
        // a typo earlier in the session don't carry penalty forward.
        cache.Remove(ipKey);

        var (token, expiresAt) = tokenGen.Generate(user);

        logger.LogInformation("Login succeeded for user {UserId} ({Username})", user.Id, user.Username);

        return new LoginResponse(
            Token: token,
            ExpiresAt: expiresAt,
            UserId: user.Id,
            Username: user.Username,
            FullName: user.FullName,
            Role: user.Role.ToString(),
            ShopId: user.ShopId,
            InventoryId: user.InventoryId
        );
    }
}
