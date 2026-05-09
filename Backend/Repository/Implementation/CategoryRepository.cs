using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class CategoryRepository(IDbConnectionFactory factory) : ICategoryRepository
{
    public async Task<List<Category>> ListAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_category_list()";
        var rows = await conn.QueryAsync<Category>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<bool> ExistsAsync(int id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_category_exists(@p_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }
}
