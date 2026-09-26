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
        // Npgsql 6+ rejects non-UTC DateTimeOffset for timestamptz params.
        // Service-layer defaults IST midnight in +05:30, so we normalise
        // to UTC at the boundary — same absolute instant, offset 0.
        return await conn.QuerySingleAsync<EodExpected>(new CommandDefinition(
            sql,
            new
            {
                p_shop_id = shopId,
                p_from    = from.ToUniversalTime(),
                p_to      = to.ToUniversalTime(),
            },
            cancellationToken: ct));
    }

    // Small POCO for the WindowFromAsync scalar. Dapper's ValueTuple binding
    // is version-fragile; a plain class with the exact column name always maps.
    private class WindowFromRow { public DateTimeOffset window_from { get; set; } }

    public async Task<DateTimeOffset> WindowFromAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        // Same rule fn_eod_close applies: last close, else the shop's first
        // billing activity, else now().
        const string sql = "SELECT fn_eod_window_from(@p_shop_id) AS window_from";
        var row = await conn.QuerySingleAsync<WindowFromRow>(
            new CommandDefinition(sql, new { p_shop_id = shopId }, cancellationToken: ct));
        return row.window_from;
    }

    public async Task<Guid> CloseAsync(
        Guid shopId, Guid userId, string denominationsJson, string? notes,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        // 25-Sep-2026: the window is decided inside fn_eod_close (previous
        // close → now), never by the client.
        const string sql =
            "SELECT fn_eod_close(@p_shop_id, @p_user_id, @p_denominations::jsonb, @p_notes)";
        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_shop_id       = shopId,
            p_user_id       = userId,
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
