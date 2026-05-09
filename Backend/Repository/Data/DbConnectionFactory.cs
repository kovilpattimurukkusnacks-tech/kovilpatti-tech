using System.Data;
using Npgsql;

namespace KovilpattiSnacks.Repository.Data;

public interface IDbConnectionFactory
{
    Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default);
}

public class NpgsqlConnectionFactory(NpgsqlDataSource dataSource) : IDbConnectionFactory
{
    public async Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken ct = default)
        => await dataSource.OpenConnectionAsync(ct);
}
