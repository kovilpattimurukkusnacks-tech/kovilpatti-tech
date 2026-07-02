namespace KovilpattiSnacks.Repository.Data;

/// <summary>
/// Holds the correlation ID for the current request scope. Set by the
/// API-layer CorrelationIdMiddleware; read by NpgsqlConnectionFactory
/// when opening a DB connection so `application_name` on the Postgres
/// side carries the same UUID as the FE header and BE logs.
///
/// Interface lives in Repository (not API) so the connection factory
/// can consume it without introducing a Repository → API dependency
/// cycle. The middleware in the API layer is the sole writer.
/// </summary>
public interface ICorrelationIdAccessor
{
    string CorrelationId { get; set; }
}

public sealed class CorrelationIdAccessor : ICorrelationIdAccessor
{
    public string CorrelationId { get; set; } = string.Empty;
}
