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

    // Small POCO for the LastCloseAtAsync scalar. Dapper's ValueTuple binding
    // is version-fragile; a plain class with the exact column name always maps.
    private class LastCloseRow { public DateTimeOffset? closed_at { get; set; } }

    public async Task<DateTimeOffset?> LastCloseAtAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        // Wrapping fn_eod_last_close in a row-shaped SELECT so Dapper's
        // NULL-scalar handling doesn't trip on the first-close case (empty
        // cash_sessions → MAX(closed_at) IS NULL).
        const string sql = "SELECT fn_eod_last_close(@p_shop_id) AS closed_at";
        var row = await conn.QueryFirstOrDefaultAsync<LastCloseRow>(
            new CommandDefinition(sql, new { p_shop_id = shopId }, cancellationToken: ct));
        return row?.closed_at;
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
            // Same UTC normalisation as ExpectedAsync — Npgsql rejects
            // non-UTC DateTimeOffset for timestamptz params.
            p_window_from   = windowFrom.ToUniversalTime(),
            p_window_to     = windowTo.ToUniversalTime(),
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
