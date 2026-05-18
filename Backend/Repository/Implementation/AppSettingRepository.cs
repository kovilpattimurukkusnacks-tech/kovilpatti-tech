using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class AppSettingRepository(IDbConnectionFactory factory) : IAppSettingRepository
{
    public async Task<List<AppSetting>> ListAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_settings_list()";
        var rows = await conn.QueryAsync<AppSetting>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<AppSetting?> GetAsync(string key, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_settings_get(@p_key)";
        return await conn.QuerySingleOrDefaultAsync<AppSetting>(
            new CommandDefinition(sql, new { p_key = key }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(string key, string value, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_settings_update(@p_key, @p_value, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_key = key, p_value = value, p_user_id = userId }, cancellationToken: ct));
    }
}
