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

    public async Task<Category?> GetAsync(int id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_category_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<Category>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(int id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_category_exists(@p_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsByNameAsync(string name, int? excludeId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_category_exists_by_name(@p_name, @p_exclude_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_name = name, p_exclude_id = excludeId }, cancellationToken: ct));
    }

    public async Task<int> CreateAsync(string name, bool active, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_category_create(@p_name, @p_active, @p_user_id)";
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            sql, new { p_name = name, p_active = active, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(int id, string name, bool active, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_category_update(@p_id, @p_name, @p_active, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_name = name, p_active = active, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(int id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_category_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
