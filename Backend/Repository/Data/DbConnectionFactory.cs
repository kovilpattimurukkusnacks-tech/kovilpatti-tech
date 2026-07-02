using System.Data;
using Npgsql;

namespace KovilpattiSnacks.Repository.Data;

public interface IDbConnectionFactory
{
    Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default);
}

/// <summary>
/// Opens Npgsql connections from the shared data source. On every open we
/// SET application_name = 'app:{correlationId}' so Supabase Postgres logs
/// carry the same ID the FE and BE logs do — one UUID grep pulls the
/// entire request trail (see CorrelationIdMiddleware).
///
/// If the request has no correlation ID (health checks, seeder, other
/// non-HTTP callers), we fall back to 'app:svc' — still tags the row as
/// coming from our app, just without per-request granularity.
/// </summary>
public class NpgsqlConnectionFactory(
    NpgsqlDataSource dataSource,
    ICorrelationIdAccessor correlation) : IDbConnectionFactory
{
    public async Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default)
    {
        var conn = await dataSource.OpenConnectionAsync(ct);

        // Tag this session in Postgres with the correlation ID. Cheap
        // (one round-trip on connection checkout; pooled connections
        // reuse the tag until re-set on next request). We wrap in a
        // try to avoid taking down the request if SET fails — the
        // trace label is nice-to-have, not required for correctness.
        try
        {
            var corrId = string.IsNullOrEmpty(correlation.CorrelationId)
                ? "svc"
                : correlation.CorrelationId;
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SET application_name = 'app:{corrId}'";
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch
        {
            // Tagging failed — connection still usable. Swallow.
        }

        return conn;
    }
}
