using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class EodRepository(IDbConnectionFactory factory) : IEodRepository
{
    public async Task<EodExpected> ExpectedAsync(
        Guid shopId, DateTimeOffset from, DateTimeOffset to, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_eod_expected(@p_shop_id, @p_from, @p_to)";
        return await conn.QuerySingleAsync<EodExpected>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_from = from, p_to = to }, cancellationToken: ct));
    }

    public async Task<DateTimeOffset?> LastCloseAtAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_eod_last_close(@p_shop_id)";
        return await conn.ExecuteScalarAsync<DateTimeOffset?>(new CommandDefinition(
            sql, new { p_shop_id = shopId }, cancellationToken: ct));
    }

    public async Task<Guid> CloseAsync(
        Guid shopId, Guid userId,
        DateTimeOffset windowFrom, DateTimeOffset windowTo,
        string denominationsJson, string? notes,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_eod_close(@p_shop_id, @p_user_id, @p_window_from, @p_window_to,
                                @p_denominations::jsonb, @p_notes)";
        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_shop_id       = shopId,
            p_user_id       = userId,
            p_window_from   = windowFrom,
            p_window_to     = windowTo,
            p_denominations = denominationsJson,
            p_notes         = notes,
        }, cancellationToken: ct));
    }

    public async Task<List<CashSessionListRow>> ListAsync(Guid shopId, int limit, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_eod_list(@p_shop_id, @p_limit)";
        var rows = await conn.QueryAsync<CashSessionListRow>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_limit = limit }, cancellationToken: ct));
        return rows.ToList();
    }
}
