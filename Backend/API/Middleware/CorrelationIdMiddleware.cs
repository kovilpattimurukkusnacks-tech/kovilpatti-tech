using KovilpattiSnacks.Repository.Data;

namespace KovilpattiSnacks.API.Middleware;

/// <summary>
/// Per-request correlation ID (30-Jun-2026). One UUID flows FE → BE → DB
/// so a single grep can pull every log line touched by a user's click.
///
///   FE  → sets  X-Correlation-Id: {uuid}  on every fetch
///   BE  → this middleware reads it (or mints one if missing), stashes it
///         on ICorrelationIdAccessor (defined in Repository) for the
///         request scope, echoes it back in the response header, and
///         adds it as an ILogger scope so every log line during the
///         request is prefixed with it.
///   DB  → NpgsqlConnectionFactory reads the accessor after opening a
///         connection and issues `SET application_name = 'app:{uuid}'`,
///         which shows up in Supabase Postgres logs alongside every query.
///
/// Search "abc123" across Railway logs + Supabase logs → full end-to-end
/// trace for that one user action, App-Insights style.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-Id";

    // Cap what we accept from the FE header — a hostile client shouldn't
    // be able to inject arbitrarily long strings into log dashboards or
    // into the DB's application_name (which caps at 63 chars anyway).
    private const int MaxLength = 36;

    public async Task InvokeAsync(
        HttpContext ctx,
        ICorrelationIdAccessor accessor,
        ILogger<CorrelationIdMiddleware> logger)
    {
        var incoming = ctx.Request.Headers[HeaderName].FirstOrDefault();
        var corrId = SanitizeOrMint(incoming);

        accessor.CorrelationId = corrId;

        // Echo back so the FE can log the *effective* ID (in case the BE
        // minted a fresh one because the FE header was empty / malformed).
        ctx.Response.Headers[HeaderName] = corrId;

        // Attach as a log scope — every ILogger call during this request
        // now emits `CorrelationId` as a structured property. Railway's
        // log viewer shows scopes inline, so grepping for the ID pulls
        // every log line for the request.
        using (logger.BeginScope(new Dictionary<string, object>
               {
                   ["CorrelationId"] = corrId,
               }))
        {
            await next(ctx);
        }
    }

    private static string SanitizeOrMint(string? incoming)
    {
        if (string.IsNullOrWhiteSpace(incoming))
            return Guid.NewGuid().ToString("N")[..12];

        // Allow only URL-safe chars; strip anything else. Trim to MaxLength.
        var cleaned = new string(incoming.Where(IsAllowed).Take(MaxLength).ToArray());
        return string.IsNullOrEmpty(cleaned)
            ? Guid.NewGuid().ToString("N")[..12]
            : cleaned;
    }

    private static bool IsAllowed(char c)
        => c is >= 'a' and <= 'z'
        or >= 'A' and <= 'Z'
        or >= '0' and <= '9'
        or '-' or '_';
}
