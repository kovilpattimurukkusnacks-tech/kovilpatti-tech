using Dapper;
using KovilpattiSnacks.Repository.Data;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace KovilpattiSnacks.API.HealthChecks;

public class DbHealthCheck(IDbConnectionFactory factory) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken ct = default)
    {
        try
        {
            using var conn = await factory.CreateOpenConnectionAsync(ct);
            var result = await conn.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT 1", cancellationToken: ct));

            return result == 1
                ? HealthCheckResult.Healthy("Database reachable.")
                : HealthCheckResult.Unhealthy($"Unexpected result from SELECT 1: {result}");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Database unreachable.", ex);
        }
    }
}
